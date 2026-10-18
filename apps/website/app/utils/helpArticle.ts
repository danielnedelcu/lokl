import MarkdownIt from "markdown-it";
import { fillHelpFacts, type PageFact } from "@repo/types";

// One Help centre article (docs/design/website-pages.md): a Markdown file in
// apps/website/content/help/<customers|hosts>/<slug>.md, with front matter
// (title, summary, order, updated) and the body. Facts are written
// {{NAME}} (HELP_FACTS in @repo/types), so an article can't drift from
// what the code does. Raw HTML is switched off: an article is text, links
// and lists, never markup. Plain TypeScript, so the help tests run it too.

export type HelpAudience = "customers" | "hosts";
export const HELP_AUDIENCES: Record<HelpAudience, { title: string; path: string }> = {
  customers: { title: "For customers", path: "/help/customers" },
  hosts: { title: "For hosts", path: "/help/hosts" },
};

export interface HelpArticle {
  slug: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  order: number;
  /** "2026-10-17": when the article last changed. */
  updated: string;
  html: string;
  /** The words, for search: title, summary, headings and body, without markup. */
  text: string;
  headings: string[];
  /** What's wrong with the file, if anything (the help tests fail on any). */
  problems: string[];
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Links in the site's text style.
md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
  tokens[i]!.attrJoin("class", "link-text");
  return self.renderToken(tokens, i, options);
};
// Tables scroll sideways in their own box on a narrow screen, never the page.
md.renderer.rules.table_open = () => '<div class="help-table" role="region" aria-label="Table" tabindex="0"><table>\n';
md.renderer.rules.table_close = () => "</table></div>\n";
const headingId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
md.renderer.rules.heading_open = (tokens, i, options, _env, self) => {
  const inline = tokens[i + 1];
  if (inline?.type === "inline") tokens[i]!.attrSet("id", headingId(inline.content));
  return self.renderToken(tokens, i, options);
};

/** `file`: the path under content/help, e.g. "customers/booking-an-experience.md". */
export function parseHelpArticle(file: string, raw: string): HelpArticle {
  const problems: string[] = [];
  const [folder, name] = file.split("/");
  const audience = (folder === "customers" || folder === "hosts" ? folder : "customers") as HelpAudience;
  if (folder !== "customers" && folder !== "hosts") problems.push(`${file}: not in customers/ or hosts/`);
  const slug = (name ?? "").replace(/\.md$/, "");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) problems.push(`${file}: the file name isn't a plain slug`);

  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) problems.push(`${file}: no front matter`);
  const front: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) front[kv[1]!] = kv[2]!.replace(/^"(.*)"$/, "$1");
  }
  for (const key of ["title", "summary", "order", "updated"]) if (!front[key]) problems.push(`${file}: no ${key}`);
  if (front.updated && !/^\d{4}-\d{2}-\d{2}$/.test(front.updated)) problems.push(`${file}: updated isn't YYYY-MM-DD`);

  const title = fillHelpFacts(front.title ?? "");
  const summary = fillHelpFacts(front.summary ?? "");
  const body = fillHelpFacts(m?.[2] ?? "");
  for (const u of [...title.unknown, ...summary.unknown, ...body.unknown]) problems.push(`${file}: no fact called {{${u}}}`);
  if (/^#\s/m.test(body.text)) problems.push(`${file}: a top-level heading in the body (the title is the page's only one)`);

  const html = md.render(body.text);
  const headings = [...body.text.matchAll(/^##\s+(.+)$/gm)].map((h) => h[1]!.trim());
  const words = `${title.text} ${summary.text} ${headings.join(" ")} ${html.replace(/<[^>]+>/g, " ")}`
    .replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  return {
    slug, audience, title: title.text, summary: summary.text, order: Number(front.order) || 0, updated: front.updated ?? "",
    html, text: words, headings, problems,
  };
}

/** Searches articles: every word must appear; title matches count most, then summary, headings, body. */
export function searchHelp(articles: HelpArticle[], query: string): HelpArticle[] {
  const words = query.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored = articles.map((a) => {
    const fields = [[a.title, 5], [a.summary, 3], [a.headings.join(" "), 2], [a.text, 1]] as const;
    let score = 0;
    for (const w of words) {
      const hit = fields.reduce((s, [text, weight]) => s + (text.toLowerCase().includes(w) ? weight : 0), 0);
      if (!hit) return { a, score: 0 };
      score += hit;
    }
    return { a, score };
  });
  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title)).map((s) => s.a);
}

/** An information page (/about, /fees, …): content/pages/<slug>.md. */
export interface InfoPage {
  slug: string;
  title: string;
  summary: string;
  updated: string;
  html: string;
  problems: string[];
}

/**
 * An information page, read like an article (front matter: title, summary,
 * updated). `facts`: what only the page knows when it's served
 * (PAGE_FACTS: the commission rates, the support address). An absent one
 * is a problem, never left blank.
 */
export function parseInfoPage(file: string, raw: string, facts: Partial<Record<PageFact, string>> = {}): InfoPage {
  const problems: string[] = [];
  const slug = file.replace(/^.*\//, "").replace(/\.md$/, "");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) problems.push(`${file}: no front matter`);
  const front: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) front[kv[1]!] = kv[2]!.replace(/^"(.*)"$/, "$1");
  }
  for (const key of ["title", "summary", "updated"]) if (!front[key]) problems.push(`${file}: no ${key}`);
  if (front.updated && !/^\d{4}-\d{2}-\d{2}$/.test(front.updated)) problems.push(`${file}: updated isn't YYYY-MM-DD`);
  const body = fillHelpFacts(m?.[2] ?? "", facts);
  for (const u of body.unknown) problems.push(`${file}: no fact called {{${u}}}`);
  if (/^#\s/m.test(body.text)) problems.push(`${file}: a top-level heading in the body (the title is the page's only one)`);
  return { slug, title: front.title ?? "", summary: front.summary ?? "", updated: front.updated ?? "", html: md.render(body.text), problems };
}
