import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";

// Journey 26: the header search (docs/design/search.md, 2026-10-12). Where,
// When, What on Reka's Navigation Menu, adapted for a form: one shared
// panel, opened by click or keyboard only, each segment a button with its
// value and aria-expanded, Escape closing it and returning focus, choosing a
// Where opening When and dates opening What. The quick dates are Atlanta's
// (the browser runs in Los Angeles, and in Auckland for @zones). The results
// address holds the filters; dates never hide Services; an empty result
// keeps the filters editable. On phones, one Search button opens a
// full-screen panel. The header is sticky and never covers what has focus.

const bar = (page: Page) => page.locator("form[role=search]:visible");
const segment = (page: Page, name: "where" | "when" | "what") => bar(page).locator(`[data-segment="${name}"]`);
const expanded = (page: Page) => bar(page).locator("[data-segment]").evaluateAll((b) => b.map((x) => x.getAttribute("aria-expanded")).join(","));
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, " ").trim() ?? "");
/** Waits for the market's (cached, a minute) areas and categories to include this test's, then loads `path`. */
async function marketHas(page: Page, path: string, { area, category }: { area?: string; category?: string }) {
  await expect.poll(async () => {
    const info = await (await page.request.get("/api/public/markets/atlanta")).json();
    return (!area || info.areas.some((a: { name: string }) => a.name === area))
      && (!category || info.categories.some((c: { slug: string; count: number }) => c.slug === category && c.count > 0));
  }, { message: "the market's areas and categories include this test's", timeout: 80_000, intervals: [3_000, 5_000] }).toBe(true);
  await page.goto(path);
}
const panel = (page: Page) => page.locator("form[role=search]:visible div[style*='--reka-navigation-menu-viewport-width']");

test("the bar: a named search form, each segment by keyboard, one shared panel, Escape, auto-advance", async ({ page, data }) => {
  const owner = await data.user("search-owner");
  const provider = await data.provider(owner, `E2E Search ${data.run}`);
  const area = await data.area();
  const walk = await data.category("experience");
  await data.listing(provider, "experience", walk.id, area, `Search walk ${data.run}`);
  await marketHas(page, "/", { area: `E2E ${data.run}` });

  // A search form, not navigation; three buttons, each with its label and value.
  const form = bar(page);
  await expect(form).toHaveAttribute("aria-label", "Search lokl");
  expect(await form.locator("nav").count(), "no <nav> inside the search").toBe(0);
  await expect(segment(page, "where")).toHaveAccessibleName("Where Anywhere in Atlanta");
  await expect(segment(page, "when")).toHaveAccessibleName("When Any dates");
  await expect(segment(page, "what")).toHaveAccessibleName("What Anything");
  for (const s of ["where", "when", "what"] as const) {
    await expect(segment(page, s)).toHaveAttribute("type", "button");
    await expect(segment(page, s)).toHaveAttribute("aria-expanded", "false");
  }
  await expect(form.getByRole("button", { name: "Search", exact: true })).toHaveAttribute("type", "submit");

  // Hover opens nothing.
  await segment(page, "when").hover();
  await page.waitForTimeout(500);
  expect(await expanded(page)).toBe("false,false,false");

  // Where by keyboard: Enter opens it (aria-controls names the panel), Tab
  // enters it, arrow keys move between pills, Escape closes and returns focus.
  await segment(page, "where").focus();
  await page.keyboard.press("Enter");
  expect(await expanded(page)).toBe("true,false,false");
  // The pill keeps its shadow while a panel is open, not only on hover.
  // (The pointer moved off it first, and its hover shadow given time to fade.)
  await page.mouse.move(5, 700);
  await page.waitForTimeout(500);
  const pill = bar(page).locator("[data-reka-navigation-menu] > div").first();
  expect(await pill.evaluate((e) => getComputedStyle(e).boxShadow), "a shadow while open").toMatch(/rgba\(0, 0, 0, 0\.[1-9]/);
  const controls = await segment(page, "where").getAttribute("aria-controls");
  await expect(page.locator(`[id="${controls}"]`)).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await focusedText(page)).toContain("Anywhere in Atlanta");
  await page.keyboard.press("Escape");
  expect(await expanded(page)).toBe("false,false,false");
  await expect(segment(page, "where"), "Escape returns focus").toBeFocused();

  // Choosing an area: When opens, focus on its button, the value shown.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const areaName = `E2E ${data.run}`;
  for (let i = 0; i < 40 && (await focusedText(page)) !== areaName; i++) await page.keyboard.press("ArrowRight");
  expect(await focusedText(page)).toBe(areaName);
  await page.keyboard.press("Space");
  await expect(segment(page, "when"), "Where → When").toBeFocused();
  expect(await expanded(page)).toBe("false,true,false");
  await expect(segment(page, "where")).toHaveAccessibleName(`Where ${areaName}, Atlanta`);

  // One shared panel: switching segments with a click keeps it, and resizes it.
  const before = await panel(page).elementHandle();
  const whenWidth = (await panel(page).boundingBox())!.width;
  await segment(page, "where").click();
  await expect.poll(async () => (await panel(page).boundingBox())!.width).not.toBe(whenWidth);
  expect(await panel(page).evaluate((el, b) => el === b, before), "the same panel element").toBe(true);
  await segment(page, "when").click();

  // A quick date: What opens, focus on its button; the bar shows the dates.
  await page.getByRole("button", { name: /^This weekend/ }).click();
  await expect(segment(page, "what"), "When → What").toBeFocused();
  expect(await expanded(page)).toBe("false,false,true");
  await expect(segment(page, "when")).not.toHaveAccessibleName(/Any dates/);

  // A click outside closes it.
  await page.locator("main").click({ position: { x: 5, y: 400 } });
  expect(await expanded(page)).toBe("false,false,false");

  // Tabbing on from an open panel's last pill to the next segment closes the panel.
  await segment(page, "where").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 40 && !(await segment(page, "when").evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(segment(page, "when")).toBeFocused();
  expect(await expanded(page), "Where's panel closed").toBe("false,false,false");
});

test("one day from the calendar: shown at once, and searched as that day", async ({ page }) => {
  await page.goto("/");
  await segment(page, "when").click();
  await page.getByRole("button", { name: /^Next month/ }).click();
  const day = page.locator("[data-reka-calendar-cell-trigger]:not([data-disabled]):not([data-outside-view])").nth(4);
  const value = await day.getAttribute("data-value");
  await day.click();
  expect(await expanded(page), "When stays open").toBe("false,true,false");
  const [y, m, d] = value!.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(y!, m! - 1, d!));
  await expect(segment(page, "when")).toHaveAccessibleName(`When ${label}`);
  await bar(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(`/atlanta/search?from=${value}&to=${value}`);
  await expect(segment(page, "when")).toHaveAccessibleName(`When ${label}`);
});

test("reduce motion: the shared panel neither resizes nor slides with animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await segment(page, "where").click();
  expect(await panel(page).evaluate((el) => getComputedStyle(el).transitionProperty), "no size transition").toBe("none");
  const content = page.locator("form[role=search]:visible [data-slot=navigation-menu-content]").first();
  expect(await content.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("@zones the quick dates and today are Atlanta's, whatever the device's zone", async ({ page }) => {
  // 11:30 PM on Friday Oct 16 in Atlanta: Saturday already in UTC (and in Auckland).
  await page.clock.setFixedTime(new Date("2026-10-17T03:30:00Z"));
  await page.goto("/");
  await segment(page, "when").click();
  await expect(page.getByRole("button", { name: /^Today/ })).toHaveAccessibleName("Today Fri, Oct 16");
  await expect(page.getByRole("button", { name: /^Tomorrow/ })).toHaveAccessibleName("Tomorrow Sat, Oct 17");
  await expect(page.getByRole("button", { name: /^This weekend/ })).toHaveAccessibleName("This weekend Sat, Oct 17 – Sun, Oct 18");
  // Today is marked on Atlanta's day; the day before can't be chosen.
  const today = page.locator("[data-market-today]");
  await expect(today).toHaveCount(1);
  await expect(today).toHaveText("16");
  await expect(page.locator("[data-reka-calendar-cell-trigger][data-disabled]").filter({ hasText: /^15$/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Today/ }).click();
  await expect(segment(page, "when")).toHaveAccessibleName("When Fri, Oct 16");
});

test("the results: the address holds the filters, browse's results and counts, dates never hide Services, an editable empty state", async ({ page, data }) => {
  test.setTimeout(150_000);
  const owner = await data.user("search-results");
  const provider = await data.provider(owner, `E2E Results ${data.run}`);
  const area = await data.area();
  const walk = await data.category("experience");
  const cut = await data.category("service");
  const listing = await data.listing(provider, "experience", walk.id, area, `Results walk ${data.run}`);
  await data.session(listing.id, new Date(Date.now() + 3 * 864e5).toISOString());
  await data.listing(provider, "service", cut.id, area, `Results cut ${data.run}`);

  // Choose all three in the bar, then Search: the address, in a fixed order.
  await marketHas(page, "/", { area: `E2E ${data.run}`, category: walk.slug });
  await segment(page, "where").click();
  await page.getByRole("button", { name: `E2E ${data.run}`, exact: true }).click();
  await page.getByRole("button", { name: /^Next month/ }).click();
  const cells = page.locator("[data-reka-calendar-cell-trigger]:not([data-disabled]):not([data-outside-view])");
  // A day in the calendar doesn't move on (a range may follow), and the bar
  // shows that day at once; a second day makes a range.
  await cells.first().click();
  expect(await expanded(page), "still on When after one day").toBe("false,true,false");
  await expect(segment(page, "when")).not.toHaveAccessibleName(/Any dates/);
  const oneDay = (await segment(page, "when").textContent())!;
  await cells.nth(2).click();
  expect(await expanded(page), "still on When after a range").toBe("false,true,false");
  await expect(segment(page, "when")).not.toHaveText(oneDay);
  await segment(page, "what").click();
  await page.getByRole("button", { name: walk.name, exact: true }).click();
  await bar(page).getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/atlanta\/search\?/);
  const url = new URL(page.url());
  expect([...url.searchParams.keys()].join(",")).toBe("area,from,to,kind,category");
  expect(url.searchParams.get("area")).toBe(area);
  expect(url.searchParams.get("kind")).toBe("experience");
  expect(url.searchParams.get("category")).toBe(walk.slug);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Experiences in Atlanta");
  await expect(segment(page, "what"), "the bar shows the search on screen").toHaveAccessibleName(`What ${walk.name}`);

  // Browse's own filtering: the same results as the browse page with these filters.
  const from = url.searchParams.get("from")!;
  const to = url.searchParams.get("to")!;
  const cards = async () => (await page.locator("main ul li h3").allTextContents()).sort();
  const searchCards = await cards();
  await page.goto(`/atlanta/experiences/${walk.slug}?area=${area}&from=${from}&to=${to}`);
  expect(await cards()).toEqual(searchCards);

  // Without a category: both kinds counted; with dates, Services aren't filtered by them.
  await page.goto(`/atlanta/search?area=${area}&from=2030-01-01&to=2030-01-02`);
  await expect(page.getByRole("link", { name: "Experiences (0)" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Services (1)" })).toBeVisible();
  await page.getByRole("link", { name: "Services (1)" }).click();
  await expect(page).toHaveURL(new RegExp(`area=${area}&from=2030-01-01&to=2030-01-02&kind=service$`));
  await expect(page.getByText("Dates apply to Experiences.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: `Results cut ${data.run}` })).toBeVisible();

  // A Service category: When says the dates don't apply.
  await page.goto(`/atlanta/search?from=2030-01-01&to=2030-01-02&kind=service&category=${cut.slug}`);
  await expect(segment(page, "when")).toHaveAccessibleName(/^When .*Dates: Experiences only/);

  // Nothing found: the filters stay editable, each removable, and the bar opens from the page.
  await page.goto(`/atlanta/search?area=${area}&from=2030-01-01&to=2030-01-02`);
  await expect(page.getByText("No Experiences match this search.")).toBeVisible();
  await page.getByRole("button", { name: /^When: / }).click();
  await expect(segment(page, "when")).toBeFocused();
  expect(await expanded(page)).toBe("false,true,false");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /remove, show Any dates/ }).click();
  await expect(page).toHaveURL(new RegExp(`/atlanta/search\\?area=${area}$`));
  await expect(page).toHaveTitle(/Search/);
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex, follow");
});

test("@phone one Search button, a full-screen panel: focus kept inside, Escape returns it, Where opens When", async ({ page, data }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const area = await data.area();
  await marketHas(page, "/", { area: `E2E ${data.run}` });
  await expect(page.locator("form[role=search]:visible")).toHaveCount(0);
  const open = page.getByRole("button", { name: /^Search: Anywhere in Atlanta, Any dates, Anything$/ });
  await expect(open).toBeVisible();
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = (await dialog.boundingBox())!;
  expect([box.x, box.y, box.width, box.height].map(Math.round), "full screen").toEqual([0, 0, 375, 812]);
  // Focus stays inside.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "focus inside the panel").toBe(true);
  }
  // Where opens When, with focus on it.
  await expect(dialog.getByRole("button", { name: /^Where/ })).toHaveAttribute("aria-expanded", "true");
  await dialog.getByRole("button", { name: `E2E ${data.run}`, exact: true }).click();
  await expect(dialog.getByRole("button", { name: /^When/ })).toBeFocused();
  await expect(dialog.getByRole("button", { name: /^When/ })).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scrolling").toBeLessThanOrEqual(375);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Search: / })).toBeFocused();
  // Search from the panel goes to the results address. Its button is the
  // hosts' orange with white text, at least 4.5:1.
  await page.getByRole("button", { name: /^Search: / }).click();
  const go = page.getByRole("dialog").getByRole("button", { name: "Search", exact: true });
  const ratio = await go.evaluate((e) => {
    const rgb = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const s = getComputedStyle(e);
    const [a, b] = [lum(rgb(s.backgroundColor)), lum(rgb(s.color))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(await go.evaluate((e) => getComputedStyle(e).backgroundColor), "the hosts' orange").toBe("rgb(201, 63, 20)");
  expect(ratio, "white text at 4.5:1 or more").toBeGreaterThanOrEqual(4.5);
  await page.getByRole("dialog").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/atlanta/search\\?area=${area}$`));
});

test("the sticky header: stays at the top, and never covers what has focus (WCAG 2.4.11)", async ({ page }) => {
  await page.goto("/");
  const header = page.locator("body header").first();
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 1500);
  // Wait for the smooth scroll (Lenis) to finish gliding, as it would before anyone Tabs.
  let last = -1;
  await expect.poll(async () => {
    const now = await page.evaluate(() => Math.round(scrollY));
    const still = now === last && now > 0;
    last = now;
    return still;
  }, { intervals: [250], timeout: 10_000 }).toBe(true);
  expect(await header.evaluate((h) => Math.round(h.getBoundingClientRect().top)), "still at the top").toBe(0);
  const headerBottom = await header.evaluate((h) => h.getBoundingClientRect().bottom);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop)).toBe(`${Math.ceil(headerBottom)}px`);
  // From the page's last link, Shift+Tab back up through it: each focused
  // element in the main content is fully below the header.
  await page.locator("main a, main button").last().focus();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Shift+Tab");
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || !a.closest("main")) return null;
      const r = a.getBoundingClientRect();
      return { top: r.top, text: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 40) };
    });
    if (!where) continue;
    await expect.poll(async () => page.evaluate(() => (document.activeElement as HTMLElement).getBoundingClientRect().top),
      { message: `not under the header: ${where.text}`, timeout: 2_000 }).toBeGreaterThanOrEqual(headerBottom - 1);
  }
});
