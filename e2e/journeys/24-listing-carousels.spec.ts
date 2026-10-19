import type { Locator, Page } from "@playwright/test";
import type { TestData } from "../support/data";
import { expect, test } from "../support/fixtures";

// Journey 24: the homepage's listing carousels (ScrollCarousel, 2026-10-12;
// docs/frontend.md, Carousels). With 12 live Services, the Services row
// shows 10 and "See all": the arrows move a page at a time and are marked
// at the ends, it snaps to a card, every card can be reached by keyboard
// (and is scrolled into view), nothing is hidden from screen readers, focus
// rings have room, "reduce motion" makes the arrows jump, a sideways
// trackpad gesture scrolls the row (not the page), and on a phone the row
// runs to both screen edges with the first card on the page's margin.
// The homepage's listings show new ones within about a second (the content
// versions are read once a second), so they're polled for briefly.

test.describe.configure({ mode: "serial" });

/** 12 live Services, and with `experiences`, 12 live Experiences too. */
async function twelveServices(data: TestData, { experiences = false } = {}) {
  const owner = await data.user("carousel-owner");
  const provider = await data.provider(owner, `E2E Carousel ${data.run}`);
  const area = await data.area();
  const category = (await data.category("service")).id;
  for (let i = 1; i <= 12; i++) await data.listing(provider, "service", category, area, `Carousel cut ${String(i).padStart(2, "0")} ${data.run}`);
  if (!experiences) return;
  const walks = (await data.category("experience")).id;
  for (let i = 1; i <= 12; i++) await data.listing(provider, "experience", walks, area, `Carousel walk ${String(i).padStart(2, "0")} ${data.run}`);
}

/** The homepage's Services row, once the cached listings show this test's 10 and "See all". */
async function servicesRow(page: Page, run: string) {
  await expect.poll(async () => {
    await page.goto("/");
    return page.getByRole("region", { name: "Services", exact: true }).getByRole("listitem").filter({ hasText: run }).count();
  }, { message: "the Services row shows this test's listings", timeout: 5_000, intervals: [250, 500] }).toBe(10);
  const row = page.getByRole("region", { name: "Services", exact: true });
  return { row, track: row.getByRole("list"), prev: row.getByRole("button", { name: "Scroll Services left" }), next: row.getByRole("button", { name: "Scroll Services right" }) };
}

/** Waits for the track to stop scrolling (smooth scrolling and snapping), and returns where it stopped. */
async function settled(track: Locator) {
  let last = -1;
  await expect.poll(async () => {
    const now = await track.evaluate((t) => t.scrollLeft);
    const still = now === last;
    last = now;
    return still;
  }, { intervals: [150], timeout: 5_000 }).toBe(true);
  return last;
}

/** Each item's left and right edge, relative to the track's visible content area (inside its padding). */
function visibleItems(track: Locator) {
  return track.evaluate((t) => {
    const r = t.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(t).paddingLeft);
    const left = r.left + pad;
    const right = r.right - parseFloat(getComputedStyle(t).paddingRight);
    return [...t.children].map((li) => {
      const b = li.getBoundingClientRect();
      return { full: b.left >= left - 1 && b.right <= right + 1, left: Math.round(b.left - left) || 0 }; // never -0
    });
  });
}

test("desktop: arrows, ends, snapping, keyboard, screen readers, focus rings, reduced motion, trackpad", async ({ page, data }) => {
  await twelveServices(data, { experiences: true });
  const { row, track, prev, next } = await servicesRow(page, data.run);

  // "On lokl now", above the carousels, is unchanged: exactly two listings,
  // one Experience and one Service (picked at random on the server), beside
  // the host card. Its picks show new listings within about a second too.
  const onLokl = page.getByRole("region", { name: "On lokl now" });
  const picked = () => onLokl.getByRole("listitem").getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  await expect.poll(async () => {
    await page.goto("/");
    const hrefs = await picked();
    return [hrefs.length, hrefs.filter((h) => h.startsWith("/experiences/")).length, hrefs.filter((h) => h.startsWith("/services/")).length,
      hrefs.every((h) => h.includes(data.run))].join(" ");
  }, { message: "one Experience and one Service from this test's listings", timeout: 5_000, intervals: [250, 500] }).toBe("2 1 1 true");
  await expect(onLokl.getByRole("heading", { name: "Offer your Services or host Experiences" })).toBeVisible();

  // A labelled section, the cards as a list: 10 and "See all", none hidden.
  const items = track.getByRole("listitem");
  await expect(items).toHaveCount(11);
  await expect(items.last()).toContainText("See all Services");
  await expect(items.last().getByRole("link")).toHaveAttribute("href", "/atlanta/services");
  expect(await track.evaluate((t) => t.querySelectorAll("[aria-hidden=true] a, a[aria-hidden=true], li[aria-hidden]").length), "nothing hidden").toBe(0);
  const trackId = await track.getAttribute("id");
  await expect(prev).toHaveAttribute("aria-controls", trackId!);
  await expect(next).toHaveAttribute("aria-controls", trackId!);

  // Within the content width, lined up with the heading; 5 cards show.
  const heading = (await row.getByRole("heading", { name: "Services", exact: true }).boundingBox())!;
  const first = (await items.first().boundingBox())!;
  expect(Math.abs(first.x - heading.x), "lined up with the content").toBeLessThan(1);
  expect((await visibleItems(track)).filter((i) => i.full).length, "5 cards show").toBe(5);
  // Focus rings have room: at least 3px inside the track on every side.
  const pad = await track.evaluate((t) => { const s = getComputedStyle(t); return [s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight].map(parseFloat); });
  expect(Math.min(...pad), "room for a focus ring").toBeGreaterThanOrEqual(3);

  // The ends: Previous marked at the start. Next moves a page: the 6th card to the left edge.
  await expect(prev).toHaveAttribute("aria-disabled", "true");
  await expect(next).not.toHaveAttribute("aria-disabled", "true");
  await next.focus();
  await page.keyboard.press("Enter");
  await settled(track);
  expect((await visibleItems(track))[5]!.left, "the 6th card at the left edge").toBe(0);
  await expect(next, "focus stays on Next").toBeFocused();
  await page.keyboard.press("Enter");
  await settled(track);
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next, "still focused at the end").toBeFocused();
  expect((await visibleItems(track)).at(-1)!.full, "the last card scrolls fully into view").toBe(true);
  await page.keyboard.press("Enter"); // marked as at the end: nothing moves
  const atEnd = await settled(track);
  expect(await track.evaluate((t) => t.scrollLeft)).toBe(atEnd);
  await prev.click();
  await prev.click();
  await settled(track);
  await expect(prev).toHaveAttribute("aria-disabled", "true");

  // Snapping: a scroll that stops part-way through a card settles on a card's start.
  await track.evaluate((t) => t.scrollTo({ left: 137, behavior: "instant" }));
  await settled(track);
  expect((await visibleItems(track)).some((i) => i.left === 0), "snapped to a card").toBe(true);
  await track.evaluate((t) => t.scrollTo({ left: 0, behavior: "instant" }));
  await settled(track);

  // Keyboard: Tab through every card; each one is scrolled fully into view.
  await next.focus();
  let reachedSeeAll = false;
  for (let i = 0; i < 30 && !reachedSeeAll; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const li = a?.closest(".carousel-item");
      const t = li?.parentElement;
      if (!a || !li || !t) return null;
      const r = t.getBoundingClientRect();
      const b = li.getBoundingClientRect();
      return { text: a.textContent?.trim() ?? "", inView: b.left >= r.left - 1 && b.right <= r.right + 1 };
    });
    if (!where) break;
    await expect.poll(async () => page.evaluate(() => {
      const li = document.activeElement?.closest(".carousel-item");
      const t = li?.parentElement;
      if (!li || !t) return false;
      const r = t.getBoundingClientRect();
      const b = li.getBoundingClientRect();
      return b.left >= r.left - 1 && b.right <= r.right + 1;
    }), { message: `focused card in view: ${where.text}`, timeout: 2_000 }).toBe(true);
    reachedSeeAll = where.text.startsWith("See all Services");
  }
  expect(reachedSeeAll, "Tab reaches every card, up to See all").toBe(true);

  // Reduce motion: the arrows jump instead of gliding.
  const behaviours = async () => page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls);
  await page.evaluate(() => {
    const w = window as unknown as { __scrolls: string[] };
    w.__scrolls = [];
    const proto = Element.prototype as unknown as { scrollBy: (...args: unknown[]) => void };
    const original = proto.scrollBy;
    proto.scrollBy = function (this: Element, ...args: unknown[]) {
      w.__scrolls.push(String((args[0] as ScrollToOptions | undefined)?.behavior));
      return original.apply(this, args);
    };
  });
  await track.evaluate((t) => t.scrollTo({ left: 0, behavior: "instant" }));
  await settled(track);
  await next.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settled(track);
  await prev.click();
  expect(await behaviours()).toEqual(["smooth", "auto"]);
  await page.emulateMedia({ reducedMotion: null });

  // A trackpad: a sideways (slightly diagonal) gesture over the row scrolls it, not the page;
  // an upward-or-downward one scrolls the page.
  await track.evaluate((t) => t.scrollTo({ left: 0, behavior: "instant" }));
  await track.scrollIntoViewIfNeeded();
  await settled(track);
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const pageBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(300, 20);
  await expect.poll(() => track.evaluate((t) => t.scrollLeft), { message: "the row scrolled sideways" }).toBeGreaterThan(0);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - pageBefore), "the page stayed put").toBeLessThan(5);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: "the page scrolled down" }).toBeGreaterThan(pageBefore + 100);
});

test("phone: the row runs to both screen edges, the first card on the page's margin, about 1.2 cards", async ({ page, data }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await twelveServices(data);
  const { track, prev, next } = await servicesRow(page, data.run);
  await track.scrollIntoViewIfNeeded();
  const t = (await track.boundingBox())!;
  expect([Math.round(t.x), Math.round(t.x + t.width)], "edge to edge").toEqual([0, 375]);
  const items = await visibleItems(track);
  const firstBox = (await track.getByRole("listitem").first().boundingBox())!;
  expect(Math.round(firstBox.x), "the first card on the page's 16px margin").toBe(16);
  expect(items.filter((i) => i.full).length, "one card shows whole").toBe(1);
  expect((await track.getByRole("listitem").nth(1).boundingBox())!.x, "and part of the next").toBeLessThan(375);
  await expect(prev).toBeVisible();
  await expect(next).toBeVisible();
  await next.click();
  await settled(track);
  expect((await visibleItems(track))[1]!.left, "Next brings the second card to the margin").toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scrolling of the page").toBeLessThanOrEqual(375);
});
