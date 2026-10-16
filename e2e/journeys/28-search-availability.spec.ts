import type { Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 28: search by availability (docs/design/service-availability.md,
// "Search"). With no kind chosen, results open on All: both kinds, a section
// each, the first 6 and "See all" (docs/design/search.md). Dates filter Services by their free times, in Atlanta days
// (the browser runs in Los Angeles, and in Auckland for @zones): only those
// free on the days, soonest first, each opening its scheduling panel on its
// first free day searched. A range is at most 31 days, in the bar, on the
// results page and in the API. Without dates, a Service with no free time
// comes last, marked "Not taking bookings yet".

const DAY = 864e5;
/** An Atlanta calendar day, `days` from today there. */
const atlantaDay = (days: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
};
/** "Friday, October 16": how the panel names a day. */
const longDay = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const cardTitles = (page: Page) => page.locator("main ul li h3").allTextContents();

test("@zones a dated search: only Services free those days, soonest first, each opening its panel on its first free day", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const area = await data.area();
  const cut = await data.category("service");
  const d = atlantaDay(3);
  // Three providers: one free early that day, one late (its title first
  // alphabetically), one with no hours at all.
  const dated = async (label: string, title: string, starts: string, ends: string) => {
    const owner = await data.user(label);
    const provider = await data.provider(owner, `E2E ${label} ${data.run}`, { ownAccount: true });
    if (starts) {
      const { error } = await data.env.db.from("provider_date_hours").insert({ provider_id: provider, on_date: d, starts, ends });
      if (error) throw new Error(error.message);
    }
    return data.listing(provider, "service", cut.id, area, `${title} ${data.run}`, "instant");
  };
  const early = await dated("early", "Zed early cut", "09:00", "11:00");
  const late = await dated("late", "Abe late cut", "15:00", "17:00");
  await dated("closed", "Mo no-hours cut", "", "");

  // That day: the two with a free time, soonest first (not by title).
  await page.goto(`/atlanta/search?from=${d}&to=${d}&kind=service&category=${cut.slug}`);
  await expect(page.getByText("2 Services")).toBeVisible();
  expect(await cardTitles(page)).toEqual([early.title, late.title]);
  // From the day before (nobody free) to that day: each opens on the day it's free.
  await page.goto(`/atlanta/search?from=${atlantaDay(2)}&to=${d}&kind=service&category=${cut.slug}`);
  await expect(page.getByText("2 Services")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(late.title) })).toHaveAttribute("href", `/services/${late.slug}?date=${d}`);
  // Another day: nobody.
  await page.goto(`/atlanta/search?from=${atlantaDay(4)}&to=${atlantaDay(4)}&kind=service&category=${cut.slug}`);
  await expect(page.getByText("No Services match this search.")).toBeVisible();

  // Signed out, the listing asks to sign in first; signed in, the panel
  // opens by itself on that day, at its first time, in Atlanta time.
  await page.goto(`/services/${late.slug}?date=${d}`);
  await expect(page.getByRole("button", { name: "Sign in to book" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await signIn(context, customer.email, customer.password);
  await page.goto(`/atlanta/search?from=${atlantaDay(2)}&to=${d}&kind=service&category=${cut.slug}`);
  await page.getByRole("link", { name: new RegExp(late.title) }).click();
  const dialog = page.getByRole("dialog", { name: `Schedule your ${late.title}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { pressed: true })).toHaveAccessibleName(new RegExp(`^${longDay(d)}(?: \\(today\\))?, \\d+ times$`));
  const times = dialog.getByRole("radiogroup", { name: `Times on ${longDay(d)}, Atlanta time (ET)` });
  await expect(times.locator("label").first()).toHaveText("3:00 PM");
});

test("with no kind chosen, results open on All: Experiences then Services, the first 6 of each, See all for the rest", async ({ page, data }) => {
  const owner = await data.user("all");
  const provider = await data.provider(owner, `E2E all ${data.run}`, { ownAccount: true });
  await data.hours(provider);
  const area = await data.area();
  const cut = await data.category("service");
  // Eight Services free that day in this area; no Experiences.
  const titles: string[] = [];
  for (let i = 1; i <= 8; i++) titles.push((await data.listing(provider, "service", cut.id, area, `All cut ${i} ${data.run}`, "instant")).title);
  const d = atlantaDay(3);
  const search = `/atlanta/search?area=${area}&from=${d}&to=${d}`;

  await page.goto(search);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Experiences and Services in Atlanta");
  await expect(page.getByRole("link", { name: "All (8)" })).toHaveAttribute("aria-current", "page");
  const experiences = page.getByRole("region", { name: "Experiences (0)" });
  const services = page.getByRole("region", { name: "Services (8)" });
  await expect(experiences).toContainText("No Experiences on these dates.");
  await expect(services.locator("h3")).toHaveCount(6);
  // Each section in the same order as its own view.
  const shown = await services.locator("h3").allTextContents();
  await services.getByRole("link", { name: "See all 8 Services" }).click();
  await expect(page).toHaveURL(new RegExp(`/atlanta/search\\?area=${area}&from=${d}&to=${d}&kind=service$`));
  await expect(page.getByRole("link", { name: "Services (8)" })).toHaveAttribute("aria-current", "page");
  // (Wait for the kind's own list: until it loads, the All view's 6 are still shown.)
  await expect(page.locator("main ul li h3")).toHaveCount(8);
  const all = await cardTitles(page);
  expect([...all].sort()).toEqual([...titles].sort());
  expect(all.slice(0, 6)).toEqual(shown);

  // The API: no kind is All, with each kind's first 6 and totals.
  const api = await (await page.request.get(`/api/public/search?market=atlanta&area=${area}&from=${d}&to=${d}`)).json();
  expect([api.view, api.sections.service.items.length, api.sections.service.total, api.sections.experience.total]).toEqual(["all", 6, 8, 0]);
});

test("a date range is at most 31 days: the calendar stops there, the results page and the API say so", async ({ page }) => {
  const today = atlantaDay(0);
  // The API: 31 days are fine; 32 are refused, in plain words.
  const ok = await page.request.get(`/api/public/search?market=atlanta&from=${today}&to=${atlantaDay(30)}`);
  expect(ok.status()).toBe(200);
  const tooLong = await page.request.get(`/api/public/search?market=atlanta&from=${today}&to=${atlantaDay(31)}`);
  expect(tooLong.status()).toBe(400);
  expect((await tooLong.json()).statusMessage).toBe("Choose up to 31 days.");

  // The results page, from a link with a longer range: says so, with ways out.
  await page.goto(`/atlanta/search?from=${today}&to=${atlantaDay(40)}`);
  await expect(page.getByText("Choose up to 31 days.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change the dates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Any dates", exact: true })).toHaveAttribute("href", "/atlanta/search");
  await expect(page.locator("main ul li h3")).toHaveCount(0);

  // The bar's calendar: from a first day, the 31st is the last choosable.
  await page.goto("/atlanta/search");
  const bar = page.locator("form[role=search]:visible");
  await bar.locator('[data-segment="when"]').click();
  await expect(bar.getByText("Dates are in Atlanta time (ET). Choose one day, or up to 31 in a row.")).toBeVisible();
  const cell = (date: string) => bar.locator(`[data-reka-calendar-cell-trigger][data-value="${date}"]`);
  await cell(atlantaDay(1)).click();
  await expect(cell(atlantaDay(31))).not.toHaveAttribute("data-disabled", /.*/);
  await expect(cell(atlantaDay(32))).toHaveAttribute("data-disabled", /.*/);
});

test("browsing without dates: a Service with no free time comes last, marked Not taking bookings yet", async ({ page, data }) => {
  const owner = await data.user("open");
  const provider = await data.provider(owner, `E2E open ${data.run}`);
  await data.hours(provider);
  const closedOwner = await data.user("shut");
  const closedProvider = await data.provider(closedOwner, `E2E shut ${data.run}`, { ownAccount: true });
  const area = await data.area();
  const cut = await data.category("service");
  // The one with no hours is the newest, so it would otherwise come first.
  const open = await data.listing(provider, "service", cut.id, area, `Open cut ${data.run}`, "instant");
  const shut = await data.listing(closedProvider, "service", cut.id, area, `Shut cut ${data.run}`, "instant");

  await page.goto(`/atlanta/services/${cut.slug}`);
  expect(await cardTitles(page)).toEqual([open.title, shut.title]);
  const cards = page.locator("main ul li");
  await expect(cards.last()).toContainText("Not taking bookings yet");
  await expect(cards.first()).not.toContainText("Not taking bookings yet");
});
