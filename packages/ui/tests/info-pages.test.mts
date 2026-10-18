// The information pages (apps/website/content/pages; docs/design/
// website-pages.md), read as the site reads them (parseInfoPage): each has
// its front matter, names only facts that exist or that the page supplies
// (PAGE_FACTS), links only to pages that exist, and makes no claim lokl
// can't stand behind (background checks, insurance, response times) except
// to say it doesn't.
// Run: npx tsx packages/ui/tests/info-pages.test.mts (part of `npm run test:ui`).
import fs from "node:fs";
import path from "node:path";
import { parseInfoPage } from "../../../apps/website/app/utils/helpArticle";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const website = new URL("../../../apps/website/", import.meta.url).pathname;
const dir = path.join(website, "content/pages");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
const facts = { SUPPORT_EMAIL: "help@hilokl.com", COMMISSION_SERVICE: "12%", COMMISSION_EXPERIENCE: "20%" };
const pages = files.map((f) => ({ f, raw: fs.readFileSync(path.join(dir, f), "utf8"), page: parseInfoPage(f, fs.readFileSync(path.join(dir, f), "utf8"), facts) }));

const pagesDir = path.join(website, "app/pages");
const staticPages = new Set(fs.readdirSync(pagesDir, { recursive: true }).map(String)
  .filter((f) => f.endsWith(".vue") && !f.includes("["))
  .map((f) => `/${f.replace(/\.vue$/, "").replace(/(^|\/)index$/, "")}`.replace(/\/$/, "") || "/"));
const helpSlugs = new Set(fs.readdirSync(path.join(website, "content/help"), { recursive: true }).map(String)
  .filter((f) => f.endsWith(".md")).map((f) => f.split("/").pop()!.replace(/\.md$/, "")));

// 1. Every page.
const expected = ["about", "accessibility", "cancellation-policy", "contact", "fees", "hosting", "how-lokl-works", "safety"];
check(expected.every((s) => files.includes(`${s}.md`)), "1a. the eight information pages are there");
for (const { f, page } of pages) check(!page.problems.length, `1b. ${f}: front matter and facts${page.problems.length ? ` (${page.problems.join("; ")})` : ""}`);
for (const s of expected) check(staticPages.has(`/${s}`), `1c. /${s} has its page`);

// 2. Facts the page supplies: filled in, and missed if absent.
const fees = pages.find((p) => p.f === "fees.md")!;
check(fees.page.html.includes("12%") && fees.page.html.includes("20%"), "2a. the Fees page shows the rates it's given");
const feesBare = parseInfoPage("fees.md", fees.raw, { SUPPORT_EMAIL: "x" });
check(feesBare.problems.some((p) => p.includes("{{COMMISSION_SERVICE}}")), "2b. without the rates, the Fees page reports a problem (never a blank)");
check(pages.every(({ page }) => !page.html.includes("{{")), "2c. no fact left unfilled");

// 3. Links.
const broken = pages.flatMap(({ f, page }) => [...page.html.matchAll(/href="([^"]+)"/g)].map((m) => ({ f, href: m[1]! }))).filter(({ href }) => {
  if (href === "mailto:help@hilokl.com") return false;
  if (!href.startsWith("/")) return true;
  const p = href.split(/[?#]/)[0]!;
  const help = p.match(/^\/help\/([a-z0-9-]+)$/);
  if (help) return !helpSlugs.has(help[1]!) && !["customers", "hosts"].includes(help[1]!);
  return !staticPages.has(p) && p !== "/help";
});
check(!broken.length, `3. every link goes to a page that exists, or the support address${broken.length ? `: ${broken.map((b) => `${b.f} → ${b.href}`).join(", ")}` : ""}`);

// 4. No claims lokl can't stand behind (only "doesn't").
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const claims = pages.flatMap(({ f, page }) => text(page.html).split(/(?<=[.!?])\s/)
  .filter((sentence) => /background check|insurance|insured|vetted|verified provider|within \d+ (hours|minutes) of your (message|report)|24\/7/i.test(sentence))
  .filter((sentence) => !/doesn't|does not|can't|cannot|isn't|no /i.test(sentence))
  .map((sentence) => `${f}: ${sentence}`));
check(!claims.length, `4. no claim of background checks, insurance or response times${claims.length ? `: ${claims.join(" | ")}` : ""}`);

console.log(failures ? `${failures} failed` : "All information page checks passed.");
process.exit(failures ? 1 : 0);
