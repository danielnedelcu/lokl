// Which browser journeys visit which pages (2026-10-19), worked out from the
// paths the journeys name (page.goto, the lists their loops open, the
// addresses they expect to land on) and Nuxt's file-based routes, for
// check:quick (scripts/quick-checks.mjs) and check:journey-pages.
//
// A path is a string or template literal starting "/": "${ADMIN}/..." is
// the admin app, any other ${...} part matches one route segment. A page's
// route comes from its file under app/pages: index is "", [x] and [[x]] are
// one segment, [...x] any rest.
import fs from "node:fs";
import path from "node:path";

export const root = new URL("..", import.meta.url).pathname;
const journeysDir = path.join(root, "e2e/journeys");

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : []);

/** Every page file of both apps, with its route as a pattern. */
export function pages() {
  return ["website", "admin"].flatMap((app) => {
    const dir = path.join(root, "apps", app, "app/pages");
    return walk(dir).filter((f) => f.endsWith(".vue")).map((file) => {
      const parts = path.relative(dir, file).replace(/\.vue$/, "").split(path.sep).filter((p) => p !== "index");
      const pattern = parts.map((p) =>
        /^\[\.\.\..+\]$/.test(p) ? ".*" : /^\[\[.+\]\]$/.test(p) ? "[^/]*" : /^\[.+\]$/.test(p) ? "[^/]+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return { app, file: path.relative(root, file), route: `/${parts.join("/")}`, re: new RegExp(`^/${pattern.join("/")}/?$`) };
    });
  });
}

/** Every journey file, with the [app, path] pairs it visits. */
export function journeys() {
  return fs.readdirSync(journeysDir).filter((f) => f.endsWith(".spec.ts")).sort().map((name) => {
    const src = fs.readFileSync(path.join(journeysDir, name), "utf8");
    const visits = [];
    // goto's own paths ("strict"), then every other path-like string
    // ("mention": lists of pages a loop opens, links, expected addresses).
    const strictSpans = [...src.matchAll(/\.goto\(\s*(["'`])/g)].map((m) => m.index + m[0].length - 1);
    for (const m of src.matchAll(/(["'`])((?:\$\{[A-Z_]+\})?\/(?:\\.|(?!\1)[^\s])*)\1/g)) {
      const kind = strictSpans.includes(m.index) ? "strict" : "mention";
      let raw = m[2].split(/[?#]/)[0];
      let app = "website";
      if (raw.startsWith("${ADMIN}")) {
        app = "admin";
        raw = raw.slice("${ADMIN}".length) || "/";
      } else if (/^\$\{[A-Z_]+\}/.test(raw)) {
        raw = raw.replace(/^\$\{[A-Z_]+\}/, "") || "/"; // another app's address (the analytics copy): the website
      }
      if (!raw.startsWith("/")) continue;
      visits.push({ app, path: raw.replace(/\$\{[^}]+\}/g, "x"), kind });
    }
    // Addresses a redirect is expected to reach, written as a regular
    // expression: toHaveURL(/\/security\/verify\?to=.../), for whichever app
    // serves it most specifically.
    for (const m of src.matchAll(/toHaveURL\(\s*\/((?:\\\/[A-Za-z0-9_-]+)+)/g)) {
      const p = m[1].replace(/\\\//g, "/");
      visits.push({ app: "either", path: p, kind: "strict" });
    }
    return { file: `e2e/journeys/${name}`, visits };
  });
}

/** How specific a route is: static segments first, as Nuxt's router picks. */
const rank = (p) => p.route.split("/").map((s) => (/^\[\.\.\./.test(s) ? 3 : /^\[\[/.test(s) ? 2 : /^\[/.test(s) ? 1 : 0));
const moreSpecific = (a, b) => {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) if ((ra[i] ?? 0) !== (rb[i] ?? 0)) return (ra[i] ?? 0) - (rb[i] ?? 0);
  return rb.length - ra.length;
};
let allPages = null;
/** The page Nuxt serves for a path in an app (the most specific route that matches), or null. */
export function pageFor(app, p, list = (allPages ??= pages())) {
  return list.filter((pg) => pg.app === app && pg.re.test(p)).sort(moreSpecific)[0] ?? null;
}

/**
 * The journeys that visit a page: paths that page serves (not a more
 * specific one). `strict`: only goto's paths and the addresses a journey
 * checks it reached; otherwise any path a journey names.
 */
export function journeysFor(page, all = journeys(), { strict = false } = {}) {
  return all.filter((j) => j.visits.some((v) => (!strict || v.kind === "strict") && servedBy(v)?.file === page.file)).map((j) => j.file);
}

/** The page a visit reaches; for an address checked by pattern ("either"), the app that serves it most specifically. */
function servedBy(v) {
  if (v.app !== "either") return pageFor(v.app, v.path);
  return ["website", "admin"].map((app) => pageFor(app, v.path)).filter(Boolean).sort(moreSpecific)[0] ?? null;
}
