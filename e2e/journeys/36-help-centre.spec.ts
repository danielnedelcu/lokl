import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../support/fixtures";

// Journey 36: the Help centre (docs/design/website-pages.md). Every article
// is listed and opens; search works by keyboard, says how many it found,
// and keeps the query in the address; links inside articles lead
// somewhere; an article's table scrolls in its own box on a phone, never
// the page; an unknown article is a 404; the sitemap lists the articles;
// breadcrumbs are plain text links, accessible (shared UiBreadcrumbs).

const contentDir = path.resolve(__dirname, "../../apps/website/content/help");
const slugs = fs.readdirSync(contentDir, { recursive: true }).map(String).filter((f) => f.endsWith(".md"))
  .map((f) => f.split("/").pop()!.replace(/\.md$/, ""));

test("every article is listed, opens, and its links lead somewhere", async ({ page, request }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Help centre" })).toBeVisible();
  for (const slug of slugs) await expect(page.locator(`a[href="/help/${slug}"]`).first()).toBeVisible();

  const checked = new Set<string>();
  for (const slug of slugs) {
    await page.goto(`/help/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Help centre" })).toBeVisible();
    // Links inside the article: each answers (a signed-out visitor is sent to sign in for the dashboard ones).
    const hrefs = await page.locator(".help-body a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      if (checked.has(href)) continue;
      checked.add(href);
      const res = await request.get(href, { maxRedirects: 0 });
      expect(res.status(), `${slug} links to ${href}`).toBeLessThan(400);
    }
  }
});

test("search by keyboard: results as you type, their number announced, the query kept in the address", async ({ page }) => {
  await page.goto("/help");
  await page.getByRole("searchbox", { name: "Search help" }).focus();
  await page.keyboard.type("refund");
  const results = page.getByRole("region", { name: /articles? found\./ });
  await expect(results.getByRole("link").first()).toHaveText("Cancellations and refunds");
  await expect(page.locator("[aria-live=polite]").filter({ hasText: /\d+ articles? found\./ })).toHaveCount(1);
  await expect(page).toHaveURL(/\?q=refund$/);
  // Tab to the first result and open it.
  await page.keyboard.press("Tab");
  await expect(results.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help\/cancellations-and-refunds$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cancellations and refunds" })).toBeVisible();
  // Back: the search is still there.
  await page.goBack();
  await expect(page.getByRole("searchbox", { name: "Search help" })).toHaveValue("refund");
  // Nothing found.
  await page.getByRole("searchbox", { name: "Search help" }).fill("zzzz");
  await expect(page.getByRole("heading", { name: "0 articles found." })).toBeVisible();
});

test("on a phone, an article's table scrolls in its own box, never the page", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/help/cancellations-and-refunds");
  const table = page.getByRole("region", { name: "Table" }).first();
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll for the page").toBe(true);
  // The box can be reached by keyboard, to scroll it.
  await table.focus();
  await expect(table).toBeFocused();
});

test("an unknown article is a 404, and the sitemap lists the articles", async ({ page, request }) => {
  const res = await page.goto("/help/no-such-article");
  expect(res?.status()).toBe(404);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const slug of slugs) expect(sitemap, `the sitemap lists /help/${slug}`).toContain(`/help/${slug}`);
});

test("breadcrumbs: plain text links in an ordered list, the current page marked, separators hidden, focus visible", async ({ page, data }) => {
  // A Help article, and a listing page (the same shared component, UiBreadcrumbs).
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  for (const [path, links, current] of [
    ["/help/booking-an-experience", ["Help centre", "For customers"], "Booking an Experience"],
    [`/experiences/${listing.slug}`, ["Atlanta", "Experiences", category.name], listing.title],
  ] as const) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(nav.locator("ol > li")).toHaveCount(links.length + 1);
    for (const name of links) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    // The current page: text, marked, never a link.
    const here = nav.locator('[aria-current="page"]');
    await expect(here).toHaveText(current);
    expect(await here.evaluate((el) => el.tagName.toLowerCase())).not.toBe("a");
    await expect(nav.getByRole("link", { name: current, exact: true })).toHaveCount(0);
    // Separators are hidden from screen readers.
    const separators = nav.locator('[data-slot="breadcrumb-separator"]');
    await expect(separators).toHaveCount(links.length);
    for (const s of await separators.all()) await expect(s).toHaveAttribute("aria-hidden", "true");
    // Plain text links: no border, no button background, at least 24px tall.
    for (const name of links) {
      const link = nav.getByRole("link", { name, exact: true });
      const look = await link.evaluate((a) => {
        const css = getComputedStyle(a);
        return { border: css.borderTopWidth, background: css.backgroundColor, underline: css.textDecorationLine, height: a.getBoundingClientRect().height };
      });
      expect(look.border, `${name}: no border`).toBe("0px");
      expect(look.background, `${name}: no button background`).toBe("rgba(0, 0, 0, 0)");
      expect(look.underline, `${name}: an underlined text link`).toBe("underline");
      expect(look.height, `${name}: at least 24px tall`).toBeGreaterThanOrEqual(24);
    }
  }
  // A visible focus ring, by keyboard.
  await page.goto("/help/booking-an-experience");
  const first = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Help centre" });
  for (let i = 0; i < 30 && !(await first.evaluate((a) => a === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  expect(await first.evaluate((a) => getComputedStyle(a).boxShadow), "a visible focus ring").not.toBe("none");
});
