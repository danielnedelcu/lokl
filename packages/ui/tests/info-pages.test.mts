// The information pages (apps/website/content/pages; docs/design/
// website-pages.md), read as the site reads them (parseInfoPage): each has
// its front matter, names only facts that exist or that the page supplies
// (PAGE_FACTS), links only to pages that exist, and makes no claim lokl
// can't stand behind (background checks, insurance, response times) except
// to say it doesn't.
// Run: npx tsx packages/ui/tests/info-pages.test.mts (part of `npm run test:ui`).
import fs from "node:fs";
import path from "node:path";
import { marketCountFacts, MARKET_COUNTS_MIN } from "@repo/types";
import { parseInfoPage } from "../../../apps/website/app/utils/helpArticle";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const website = new URL("../../../apps/website/", import.meta.url).pathname;
const dir = path.join(website, "content/pages");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
const facts = { SUPPORT_EMAIL: "help@hilokl.com", COMMISSION_SERVICE: "12%", COMMISSION_EXPERIENCE: "20%", ...marketCountFacts(14, 25) };
const pages = files.map((f) => ({ f, raw: fs.readFileSync(path.join(dir, f), "utf8"), page: parseInfoPage(f, fs.readFileSync(path.join(dir, f), "utf8"), facts) }));

const pagesDir = path.join(website, "app/pages");
const staticPages = new Set(fs.readdirSync(pagesDir, { recursive: true }).map(String)
  .filter((f) => f.endsWith(".vue") && !f.includes("["))
  .map((f) => `/${f.replace(/\.vue$/, "").replace(/(^|\/)index$/, "")}`.replace(/\/$/, "") || "/"));
const helpSlugs = new Set(fs.readdirSync(path.join(website, "content/help"), { recursive: true }).map(String)
  .filter((f) => f.endsWith(".md")).map((f) => f.split("/").pop()!.replace(/\.md$/, "")));

// 1. Every page.
const expected = ["about", "accessibility", "cancellation-policy", "contact", "fees", "hosting", "how-lokl-works", "privacy", "safety", "terms", "terms-hosts"];
check(expected.every((s) => files.includes(`${s}.md`)), "1a. the information pages and legal drafts are there");
for (const { f, page } of pages) check(!page.problems.length, `1b. ${f}: front matter and facts${page.problems.length ? ` (${page.problems.join("; ")})` : ""}`);
for (const s of expected) check(staticPages.has(`/${s.replace(/^terms-hosts$/, "terms/hosts")}`), `1c. ${s} has its page`);

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
  // Atlanta's own page (the [market] route), the one market so far.
  return !staticPages.has(p) && p !== "/help" && p !== "/atlanta";
});
check(!broken.length, `3. every link goes to a page that exists, or the support address${broken.length ? `: ${broken.map((b) => `${b.f} → ${b.href}`).join(", ")}` : ""}`);

// 4. No claims lokl can't stand behind (only "doesn't").
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const claims = pages.flatMap(({ f, page }) => text(page.html).split(/(?<=[.!?])\s/)
  .filter((sentence) => /background check|insurance|insured|vetted|verified provider|within \d+ (hours|minutes) of your (message|report)|24\/7/i.test(sentence))
  .filter((sentence) => !/doesn't|does not|can't|cannot|isn't|no /i.test(sentence))
  .map((sentence) => `${f}: ${sentence}`));
check(!claims.length, `4. no claim of background checks, insurance or response times${claims.length ? `: ${claims.join(" | ")}` : ""}`);

// 5. Readable structure: headings go down one level at a time (h1 is the
// page title, so the body starts at h2), and every image says what it shows.
for (const { f, page } of pages) {
  const levels = [1, ...[...page.html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]))];
  check(levels.every((l, i) => i === 0 || l <= levels[i - 1]! + 1), `5a. ${f}: headings in order (${levels.slice(1).join(" ")})`);
  check([...page.html.matchAll(/<img [^>]*>/g)].every((m) => /alt="[^"]+"/.test(m[0])), `5b. ${f}: every image has alt text`);
}

// 6. The About page (2026-10-18): its sections in order; its numbers are
// live, so without them it reports a problem rather than showing a blank.
const about = pages.find((p) => p.f === "about.md")!;
const h2s = [...about.page.html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
check(JSON.stringify(h2s) === JSON.stringify(["Who we are", "Why lokl exists", "Who we serve", "What we stand for", "How it works", "Where to go next"]), `6a. About has its six sections in order (${h2s.join(", ")})`);
check(about.page.html.includes("browse 14 categories") && about.page.html.includes("in 25 neighborhoods"), "6b. ...with the live numbers it's given");
check(parseInfoPage("about.md", about.raw, { SUPPORT_EMAIL: "x", COMMISSION_SERVICE: "1%", COMMISSION_EXPERIENCE: "2%" }).problems.some((p) => p.includes("{{MARKET_CATEGORIES}}")), "6c. ...and without them, a problem (never a made-up number)");
check(["/fees", "/review-rules", "/privacy", "/accessibility", "/how-lokl-works", "/atlanta", "/hosting", "/help", "/contact"].every((h) => about.page.html.includes(`href="${h}"`)), "6d. it links each value to its page, How lokl works, and the four next steps");
// 6f. The numbers show only once both reach MARKET_COUNTS_MIN (5): below it
// the sentence is left out, with no problem and no blank; at it, they show.
const aboutWith = (categories: number, neighborhoods: number) =>
  parseInfoPage("about.md", about.raw, { ...facts, ...marketCountFacts(categories, neighborhoods) });
const min = MARKET_COUNTS_MIN;
for (const [c, n] of [[min - 1, min], [min, min - 1], [2, 1]] as const) {
  const p = aboutWith(c, n);
  check(!p.problems.length && !p.html.includes("You can browse") && !p.html.includes("{{") && p.html.includes("Every listing on lokl is in Atlanta today."),
    `6f. ${c} categories and ${n} neighborhoods: the numbers sentence is left out, the rest of Atlanta stays`);
}
const atMin = aboutWith(min, min);
check(!atMin.problems.length && atMin.html.includes(`browse ${min} categories of Services and Experiences, in ${min} neighborhoods.`), `6g. ${min} and ${min}: it shows by itself`);
if (about.page.html.includes("LAUNCH-PLACEHOLDER")) console.log("note 6e. About still has the placeholder for the founder's words (replace before launch).");

// 8. The legal drafts (step 4; decided 2026-10-17): each says it's a draft
// for a lawyer, carries the marker until it's final, names the legal
// entity's placeholders, links the others, and the Privacy Policy says
// what About promises.
const legal = ["privacy.md", "terms.md", "terms-hosts.md"].map((f) => pages.find((p) => p.f === f)!);
check(legal.every((p) => p.raw.includes("**Draft: to be reviewed by a lawyer before launch** (LAUNCH-PLACEHOLDER)")), "8a. each legal page says it's a draft for a lawyer, with the marker");
check(legal.every((p) => p.raw.includes("[lokl's legal name] (LAUNCH-PLACEHOLDER)") && p.raw.includes("[address] (LAUNCH-PLACEHOLDER)")), "8b. ...and names the legal entity's placeholders, each marked");
const privacy = legal[0]!.page.html;
check(privacy.includes("We don't sell your personal information.") && about.page.html.includes('href="/privacy"'), "8c. the Privacy Policy says what About promises, and About links to it");
check(privacy.includes("Google shares your name, email address and profile photo") && privacy.includes("_ga") && privacy.includes("Global Privacy Control"), "8d. it names what Google sign-in shares, the analytics cookies and Global Privacy Control");
check(legal[2]!.page.html.includes("You see them until 30 days after the booking ends.") && legal[0]!.page.html.includes("hosts lose access 30 days after the booking ends"),
  "8f. the host Terms and the Privacy Policy state the 30-day limit on customers' details, from CONTACT_ACCESS, as built");
check(legal[1]!.page.html.includes('href="/terms/hosts"') && legal[2]!.page.html.includes('href="/terms"') && legal[1]!.page.html.includes('href="/privacy"'), "8e. the terms link each other and the Privacy Policy");

// 7. Every placeholder carries the fixed marker LAUNCH-PLACEHOLDER
// (scripts/launch-placeholders.mjs), which a deployable build is searched
// for: a paragraph that reads like a placeholder without it would slip
// through. Information pages and Help centre articles.
const helpDir = path.join(website, "content/help");
const texts = [...pages.map(({ f, raw }) => ({ f, raw })),
  ...fs.readdirSync(helpDir, { recursive: true }).map(String).filter((f) => f.endsWith(".md")).map((f) => ({ f, raw: fs.readFileSync(path.join(helpDir, f), "utf8") }))];
const unmarked = texts.flatMap(({ f, raw }) => raw.split(/\n{2,}/)
  .filter((block) => /placeholder|to be replaced|before launch|\[lokl's legal name\]|\[address\]|\bTODO\b|\bTBD\b|lorem ipsum/i.test(block) && !block.includes("LAUNCH-PLACEHOLDER"))
  .map((block) => `${f}: ${block.slice(0, 60)}`));
check(!unmarked.length, `7. every placeholder carries the LAUNCH-PLACEHOLDER marker${unmarked.length ? `: ${unmarked.join(" | ")}` : ""}`);

console.log(failures ? `${failures} failed` : "All information page checks passed.");
process.exit(failures ? 1 : 0);
