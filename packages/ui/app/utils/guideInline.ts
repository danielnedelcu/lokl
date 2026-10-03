// Turns the inline HTML that Editor.js stores in a guide's text (bold,
// italic, links) into a small tree that GuideBody draws with Vue, so text is
// always escaped and never inserted as HTML. Anything else (other tags,
// attributes, scripts, unsafe links) is dropped and only its text kept.
// No DOM needed: it runs the same on the server and in the browser.
import { h, type VNode } from "vue";

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold" | "italic"; children: InlineNode[] }
  | { type: "link"; href: string; external: boolean; children: InlineNode[] }
  | { type: "break" };

type Container = { type: "root" | "bold" | "italic" | "link" | "dropped"; tag: string; children: InlineNode[]; href?: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** A link lokl will draw: https:// addresses, or paths on this site ("/…", not "//…"). Null otherwise. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  // Browsers ignore control characters and whitespace inside a scheme
  // ("java\tscript:"), so remove them before checking.
  const href = decodeEntities(raw).replace(/[\u0000- \u007f]/g, "");
  if (/^https:\/\/[^/\\]/i.test(href)) return { href, external: true };
  if (/^\/(?![/\\])/.test(href)) return { href, external: false };
  return null;
}

const KIND: Record<string, Container["type"]> = { b: "bold", strong: "bold", i: "italic", em: "italic", a: "link" };

export function parseInline(html: string): InlineNode[] {
  const root: Container = { type: "root", tag: "", children: [] };
  const stack: Container[] = [root];
  const top = () => stack[stack.length - 1]!;
  const close = (c: Container) => {
    const parent = top();
    if (c.type === "bold" || c.type === "italic") parent.children.push({ type: c.type, children: c.children });
    else if (c.type === "link") {
      const safe = safeHref(c.href ?? "");
      if (safe) parent.children.push({ type: "link", ...safe, children: c.children });
      else parent.children.push(...c.children);
    } else parent.children.push(...c.children);
  };
  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    const last = top().children.at(-1);
    if (last?.type === "text") last.text += text;
    else top().children.push({ type: "text", text });
  };

  // Tags, and the text between them. A "<" that doesn't start a tag (as
  // in "a < b") is text, as it is to a browser.
  const re = /<(\/?)([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|<!--[\s\S]*?(?:-->|$)/gi;
  let at = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    pushText(html.slice(at, m.index));
    at = re.lastIndex;
    if (!m[2]) continue; // a comment
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      if (!closing) top().children.push({ type: "break" });
      continue;
    }
    // Script and style contents are never text on the page.
    if ((tag === "script" || tag === "style") && !closing) {
      const end = html.toLowerCase().indexOf(`</${tag}`, at);
      const after = end === -1 ? html.length : html.indexOf(">", end) + 1 || html.length;
      at = re.lastIndex = after;
      continue;
    }
    if (closing) {
      const i = stack.map((c) => c.tag).lastIndexOf(tag);
      if (i > 0) while (stack.length > i) close(stack.pop()!);
      continue;
    }
    const kind = KIND[tag] ?? "dropped";
    const href = kind === "link" ? /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[3] ?? "") : null;
    stack.push({ type: kind, tag, children: [], href: href ? (href[1] ?? href[2] ?? href[3] ?? "") : undefined });
  }
  pushText(html.slice(at));
  while (stack.length > 1) close(stack.pop()!);
  return root.children;
}

/** The plain text of inline HTML (for headings in a table of contents, alt text, search). */
export function inlineText(html: string): string {
  const walk = (nodes: InlineNode[]): string =>
    nodes.map((n) => (n.type === "text" ? n.text : n.type === "break" ? " " : walk(n.children))).join("");
  return walk(parseInline(html));
}

/**
 * Vue nodes for inline HTML: text escaped by Vue, only bold, italic, line
 * breaks and safe links kept. Links to other sites get rel="noopener noreferrer".
 */
export function inlineVNodes(html: string): (VNode | string)[] {
  const draw = (nodes: InlineNode[]): (VNode | string)[] =>
    nodes.map((n) => {
      switch (n.type) {
        case "text":
          return n.text;
        case "break":
          return h("br");
        case "bold":
          return h("strong", draw(n.children));
        case "italic":
          return h("em", draw(n.children));
        case "link":
          return h(
            "a",
            { href: n.href, class: "font-medium", ...(n.external ? { rel: "noopener noreferrer" } : {}) },
            draw(n.children),
          );
      }
    });
  return draw(parseInline(html));
}
