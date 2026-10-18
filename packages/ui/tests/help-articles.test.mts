// The Help centre's articles (apps/website/content/help; docs/design/
// website-pages.md), read as the site reads them (helpArticle.ts): each has
// its front matter and names only facts that exist (HELP_FACTS), slugs are
// unique, every link goes to a page that exists or another article, no raw
// HTML gets through, and search finds what it should.
// Run: npx tsx packages/ui/tests/help-articles.test.mts (part of `npm run test:ui`).
import fs from "node:fs";
import path from "node:path";
import { parseHelpArticle, searchHelp } from "../../../apps/website/app/utils/helpArticle";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const website = new URL("../../../apps/website/", import.meta.url).pathname;
const contentDir = path.join(website, "content/help");
const files = fs.readdirSync(contentDir, { recursive: true }).map(String).filter((f) => f.endsWith(".md")).sort();
const articles = files.map((f) => parseHelpArticle(f, fs.readFileSync(path.join(contentDir, f), "utf8")));

// The website's pages without a [parameter] in their path (links must go to one of these, or an article).
const pagesDir = path.join(website, "app/pages");
const staticPages = new Set(fs.readdirSync(pagesDir, { recursive: true }).map(String)
  .filter((f) => f.endsWith(".vue") && !f.includes("["))
  .map((f) => `/${f.replace(/\.vue$/, "").replace(/(^|\/)index$/, "")}`.replace(/\/$/, "") || "/"));
const slugs = new Set(articles.map((a) => a.slug));

// 1. Every article.
check(articles.length >= 15, `1a. the articles are there (${articles.length})`);
for (const a of articles) {
  check(!a.problems.length, `1b. ${a.audience}/${a.slug}: front matter and facts${a.problems.length ? ` (${a.problems.join("; ")})` : ""}`);
}
check(articles.filter((a) => a.audience === "customers").length >= 6 && articles.filter((a) => a.audience === "hosts").length >= 9,
  "1c. customers and hosts both have their articles");
check(slugs.size === articles.length, "1d. every slug is unique");
check(!slugs.has("customers") && !slugs.has("hosts"), "1e. no slug clashes with /help/customers or /help/hosts");

// 2. Links and markup.
const links = articles.flatMap((a) => [...a.html.matchAll(/href="([^"]+)"/g)].map((m) => ({ a, href: m[1]! })));
const broken = links.filter(({ href }) => {
  if (!href.startsWith("/")) return true; // no links to other sites
  const p = href.split(/[?#]/)[0]!;
  const help = p.match(/^\/help\/([a-z0-9-]+)$/);
  if (help) return !slugs.has(help[1]!) && !["customers", "hosts"].includes(help[1]!);
  return !staticPages.has(p) && p !== "/help";
});
check(!broken.length, `2a. every link goes to a page that exists or another article${broken.length ? `: ${broken.map((b) => `${b.a.slug} → ${b.href}`).join(", ")}` : ""}`);
check(articles.every((a) => !a.html.includes("{{") && !/<script|<iframe|<img/i.test(a.html)), "2b. no fact left unfilled, and no raw markup");
const sneaky = parseHelpArticle("customers/x.md", "---\ntitle: X\nsummary: Y\norder: 1\nupdated: 2026-10-17\n---\n<script>alert(1)</script> [a](javascript:alert(1)) {{NOT_A_FACT}}");
check(!sneaky.html.includes("<script>") && !/href="javascript:/i.test(sneaky.html) && sneaky.html.includes("&lt;script&gt;"),
  "2c. raw HTML is shown as text, and a script link is never made a link");
check(sneaky.problems.some((p) => p.includes("{{NOT_A_FACT}}")), "2d. an unknown fact is a problem");

// 3. Facts are filled in from the code.
const cancel = articles.find((a) => a.slug === "cancellations-and-refunds")!;
check(cancel.text.includes("48 hours or more before the start") && cancel.text.includes("Within 1 hour of booking"), "3. the cancellation article says 48 hours and 1 hour (from the code)");

// 4. Search.
check(searchHelp(articles, "refund")[0]?.slug === "cancellations-and-refunds", "4a. \"refund\" finds Cancellations and refunds first");
check(searchHelp(articles, "stripe bank")[0]?.audience === "hosts", "4b. \"stripe bank\" finds a hosts' article first");
check(searchHelp(articles, "zzzz").length === 0 && searchHelp(articles, " ").length === 0, "4c. nothing for nonsense or an empty search");

console.log(failures ? `${failures} failed` : "All help article checks passed.");
process.exit(failures ? 1 : 0);
