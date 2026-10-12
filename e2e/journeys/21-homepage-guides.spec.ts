import type { Locator, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 21: the homepage's guides, three places (2026-10-11): a slim h1
// and the main guide alone at the top, then "On lokl now" with the Browse
// links, then the guides section (text, then up to two cards). Without a
// main guide, the homepage is as before and shows no guides. The admin
// chooses a main guide and up to two more, never the same twice, and
// previews the real order. The homepage's guides are cached for a minute,
// so a changed homepage is polled for (as journey 8 does); the layouts with
// one card or none are checked in the admin's preview, which uses the same
// components without the cache.

test.describe.configure({ mode: "serial" });

const HEADLINE = "Book local Experiences and Services in Atlanta";

/** Every h1 to h3 in an area, in order, as "h2 Title". */
async function headings(area: Locator) {
  return area.locator("h1, h2, h3").evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null || e.classList.contains("sr-only"))
      .map((e) => `${e.tagName.toLowerCase()} ${(e.textContent ?? "").trim().replace(/\s+/g, " ")}`));
}

/** What the admin page announced to screen readers (its status line; the page has others). */
const announced = (page: Page, text: string) =>
  expect(page.getByRole("status").filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })).toHaveCount(1);

/** The homepage, once its cached guides have caught up with `ready`. */
async function homepageWhen(page: Page, ready: (page: Page) => Promise<boolean>, what: string) {
  await expect.poll(async () => {
    await page.goto("/");
    return ready(page);
  }, { message: what, timeout: 80_000, intervals: [3_000, 5_000] }).toBe(true);
}

test("without a main guide, the homepage is as before and shows no guides", async ({ page, data }) => {
  const admin = await data.user("admin", { admin: true });
  const a = await data.publishedGuide("Westside walk", admin);
  const b = await data.publishedGuide("Eastside eats", admin);
  // Cards saved, but no main guide (as when the main guide is unpublished).
  await data.setHomepage([a.id, b.id], { main: false });

  await homepageWhen(page, async (p) => (await p.getByRole("region", { name: "Featured guide" }).count()) === 0, "no main guide shown");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
  await expect(main.getByRole("link", { name: "Browse Experiences" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Guides to Atlanta" })).toHaveCount(0);
  await expect(main.getByText("Westside walk")).toHaveCount(0);
});

test("the admin chooses a main guide and two more, and the homepage shows them in order", async ({ page, context, data }) => {
  test.setTimeout(180_000);
  const admin = await data.user("admin", { admin: true });
  const main = await data.publishedGuide("Old Fourth Ward murals", admin);
  const one = await data.publishedGuide("Westside walk", admin);
  const two = await data.publishedGuide("Eastside eats", admin);
  await data.setHomepage([]);

  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/content/homepage`);
  const cardsArea = page.getByRole("region", { name: /^More guides/ });
  const preview = page.getByRole("region", { name: "Preview" });

  // No cards without a main guide.
  await expect(cardsArea.getByRole("combobox", { name: "Add a guide" })).toBeDisabled();
  await expect(cardsArea.getByText("Choose a main guide first: cards only show below one.")).toBeVisible();

  // The main guide.
  const pick = async (field: string, title: string) => {
    const box = page.getByRole("combobox", { name: field });
    await box.fill(title.split(" ")[0]!);
    await page.getByRole("option", { name: title }).click();
  };
  await pick("Choose the main guide", main.title);
  await page.getByRole("region", { name: "Main guide" }).getByRole("button", { name: "Choose" }).click();
  await announced(page, `${main.title} is the main guide.`);

  // Only the main guide: the preview's guides section is a slim row, text and link only.
  await expect(preview.getByRole("region", { name: "Guides to Atlanta" }).getByRole("link", { name: "See all guides" })).toBeVisible();
  await expect(preview.getByRole("region", { name: "Guides to Atlanta" }).getByRole("listitem")).toHaveCount(0);

  // Never the same guide twice: the main guide isn't offered as a card.
  await cardsArea.getByRole("combobox", { name: "Add a guide" }).fill("Old");
  await expect(page.getByRole("option", { name: main.title })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await pick("Add a guide", one.title);
  await cardsArea.getByRole("button", { name: "Add" }).click();
  // One card: the text takes two of the three columns.
  const section = preview.getByRole("region", { name: "Guides to Atlanta" });
  await expect(section.getByRole("listitem")).toHaveCount(1);

  await pick("Add a guide", two.title);
  await cardsArea.getByRole("button", { name: "Add" }).click();
  await expect(cardsArea.getByRole("heading", { name: "More guides (2 of 2)" })).toBeVisible();
  await expect(cardsArea.getByRole("combobox", { name: "Add a guide" })).toBeDisabled();
  await expect(cardsArea.getByText("That's two, the most the guides section shows.")).toBeVisible();

  // Reorder with the keyboard: named for where it goes; focus stays on the row.
  const down = cardsArea.getByRole("button", { name: `Move ${one.title} down, to card 2` });
  await down.focus();
  await page.keyboard.press("Enter");
  await announced(page, `Moved ${one.title} to card 2.`);
  // At the end now, so the row's other move button has focus.
  await expect(cardsArea.getByRole("button", { name: `Move ${one.title} up, to card 1` })).toBeFocused();
  await expect(cardsArea.getByRole("button", { name: `Move ${one.title} down, to card 3` })).toBeDisabled();

  // The preview in the homepage's order: main guide, "On lokl now", then the section's cards.
  expect(await headings(preview)).toEqual([
    "h2 Preview", `h2 ${main.title}`, "h2 Guides to Atlanta", `h3 ${two.title}`, `h3 ${one.title}`,
  ]);
  await expect(preview.getByText("On lokl now: listings show here")).toBeVisible();

  // Clearing the main guide with cards chosen: Save is off, and says why.
  await page.getByRole("button", { name: `Clear the main guide (${main.title})` }).click();
  await announced(page, "Main guide cleared.");
  const save = page.getByRole("button", { name: "Save the homepage" });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription("Choose a main guide, or remove the cards: cards only show below a main guide.");
  await pick("Choose the main guide", main.title);
  await page.getByRole("region", { name: "Main guide" }).getByRole("button", { name: "Choose" }).click();
  await save.click();
  await expect(page.getByText("Saved. The homepage shows these within a minute.")).toBeVisible();

  // The homepage, once its cached guides catch up.
  await context.clearCookies();
  await homepageWhen(page, async (p) => (await p.getByRole("region", { name: "Featured guide" }).getByText(main.title).count()) > 0, "the main guide shown");
  const body = page.getByRole("main");
  expect(await headings(body)).toEqual([
    `h1 ${HEADLINE}`, `h2 ${main.title}`, "h2 On lokl now", "h3 Offer your Services or host Experiences",
    "h2 Guides to Atlanta", `h3 ${two.title}`, `h3 ${one.title}`, "h2 Got a skill? Get booked.",
  ]);
  // "On lokl now" has one link in its header: "Everything in Atlanta" (no Browse links).
  const onLokl = body.getByRole("region", { name: "On lokl now" });
  const everything = onLokl.getByRole("link", { name: "Everything in Atlanta" });
  await expect(everything).toHaveAttribute("href", "/atlanta");
  await expect(onLokl.getByRole("link", { name: /^Browse / })).toHaveCount(0);
  // The host card is the right-hand column of "On lokl now", and the
  // hosting section closes the page; both invite people to host.
  // Signed out, "Get started" and "Start hosting" open sign-in (journey 22 follows them through).
  await expect(onLokl.getByRole("button", { name: "Get started" })).toHaveAttribute("aria-haspopup", "dialog");
  const hostCard = await onLokl.getByRole("heading", { name: "Offer your Services or host Experiences" }).boundingBox();
  const lokl = await onLokl.boundingBox();
  expect(hostCard!.x, "the host card is in the right-hand column").toBeGreaterThan(lokl!.x + lokl!.width * 0.6);
  const hosting = body.getByRole("region", { name: "Got a skill? Get booked." });
  await expect(hosting.getByRole("button", { name: "Start hosting" })).toHaveAttribute("aria-haspopup", "dialog");
  await expect(hosting.getByRole("listitem")).toHaveText([/^No upfront fees/, /^Your price, your place/, /^Paid through Stripe/]);
  const guides = body.getByRole("region", { name: "Guides to Atlanta" });
  await expect(guides.getByRole("link", { name: "See all guides" })).toHaveAttribute("href", "/atlanta/guides");

  // The link styles (docs/frontend.md, Links): secondary links are lighter
  // than primary ones, 36px against 44px, and still 44px to tap.
  const seeAll = guides.getByRole("link", { name: "See all guides" });
  for (const secondary of [everything, seeAll]) {
    await expect(secondary).toHaveClass(/\blink-secondary\b/);
    expect((await secondary.boundingBox())!.height, "a secondary link is 36px tall").toBe(36);
  }
  // The header's menu: tertiary links, the same size without a border.
  const menuLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Experiences" });
  await expect(menuLink).toHaveClass(/\blink-tertiary\b/);
  expect((await menuLink.boundingBox())!.height, "a tertiary link is 36px tall").toBe(36);
  expect(await menuLink.evaluate((e) => getComputedStyle(e).borderTopWidth), "...with no border").toBe("0px");
  for (const primary of [onLokl.getByRole("button", { name: "Get started" }), hosting.getByRole("button", { name: "Start hosting" })]) {
    await expect(primary).toHaveClass(/\blink-primary\b/);
    expect((await primary.boundingBox())!.height, "a primary link is 44px tall").toBe(44);
  }
  await seeAll.scrollIntoViewIfNeeded(); // elementFromPoint only finds what's on screen
  const seeAllBox = (await seeAll.boundingBox())!;
  const tapped = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest("a")?.textContent?.trim(), [seeAllBox.x + seeAllBox.width / 2, seeAllBox.y - 3]);
  expect(tapped, "a tap just above a secondary link still reaches it").toBe("See all guides");

  // The hosting section lines up with the other sections.
  const panel = (await hosting.locator("> div").boundingBox())!;
  const loklHeading = (await onLokl.getByRole("heading", { name: "On lokl now" }).boundingBox())!;
  expect(Math.abs(panel.x - loklHeading.x), "the hosting section starts where the others do").toBeLessThan(1);

  // Wide: the text on the left of the cards, level with them.
  const text = await guides.getByRole("heading", { name: "Guides to Atlanta" }).boundingBox();
  const firstCard = await guides.getByRole("listitem").first().boundingBox();
  expect(text!.x + text!.width, "the text is left of the cards").toBeLessThanOrEqual(firstCard!.x);
  expect(Math.abs(text!.y - firstCard!.y), "...and level with them").toBeLessThan(40);

  // A phone: the text first, then the cards, one under the other.
  await page.setViewportSize({ width: 375, height: 800 });
  const phoneText = await guides.getByRole("link", { name: "See all guides" }).boundingBox();
  const [c1, c2] = [await guides.getByRole("listitem").nth(0).boundingBox(), await guides.getByRole("listitem").nth(1).boundingBox()];
  expect(phoneText!.y + phoneText!.height, "the text comes before the cards").toBeLessThanOrEqual(c1!.y);
  expect(c1!.y + c1!.height, "the cards stack").toBeLessThanOrEqual(c2!.y);
});

test("the admin is told when the saved main guide's market is closed", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const closedMarket = await data.market(`Closedville ${data.run}`);
  const main = await data.publishedGuide("Closedville stroll", admin, closedMarket);
  await data.setHomepage([main.id]);
  await data.env.db.from("cities").update({ active: false }).eq("id", closedMarket);

  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/content/homepage`);
  await expect(page.getByText("The main guide's market is closed, so visitors see no guides. Choose a guide from an open market.")).toBeVisible();
});

test("the admin is told when the main guide was unpublished", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const card = await data.publishedGuide("Westside walk", admin);
  await data.setHomepage([card.id], { main: false });

  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/content/homepage`);
  await expect(page.getByText("The main guide was unpublished, so the homepage shows no guides until you choose one.")).toBeVisible();
  const save = page.getByRole("button", { name: "Save the homepage" });
  await expect(page.getByRole("region", { name: /^More guides/ }).getByText(card.title)).toBeVisible();
  // Nothing to save yet, and cards can't be saved without a main guide.
  await expect(save).toBeDisabled();
});
