import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { atlantaDate, atlantaTime, daysFromNow } from "../support/data";
import { ANALYTICS, GOOGLE_ANALYTICS_HOSTS, testEnv } from "../support/env";
import { expect, stopAtStripe, test } from "../support/fixtures";

// Journey 35: what Google Analytics is sent (decided 2026-10-17), on the
// tests' analytics server (the website with a made-up id; scripts/e2e.mjs).
// Nothing reaches Google: every request to it is caught here and answered
// locally (its script with an empty stand-in). What lokl hands to Google's
// script is read from its queue (window.dataLayer), recorded as it's pushed
// so it survives the page leaving for Stripe. Checked:
// - the settings: Signals and ad personalisation off, no automatic page
//   views, Consent Mode denying advertising;
// - exactly the planned events, with exactly their parameters, cleaned
//   page addresses, and nothing personal (no name, email, phone or booking
//   id);
// - no analytics at all on sign-in, account and dashboard pages, or with
//   Global Privacy Control.

type Command = unknown[];

/** Records lokl's commands to Google's script, and every request to Google (answered locally). */
async function watchAnalytics(context: BrowserContext) {
  const env = await testEnv();
  const commands: Command[] = [];
  const google: string[] = [];
  const outside: string[] = [];
  await context.exposeBinding("__gaRecord", (_source, json: string) => {
    commands.push(JSON.parse(json) as Command);
  });
  await context.addInitScript(() => {
    const queue: unknown[] = [];
    const push = queue.push.bind(queue);
    queue.push = (...items: unknown[]) => {
      for (const item of items) {
        try {
          (window as unknown as { __gaRecord: (s: string) => void }).__gaRecord(JSON.stringify(Array.from(item as ArrayLike<unknown>)));
        } catch {
          // a command that isn't a list: not one of lokl's
        }
      }
      return push(...items);
    };
    (window as unknown as { dataLayer: unknown[] }).dataLayer = queue;
  });
  const allowed = new Set([new URL(ANALYTICS).host, new URL(env.apiUrl).host]);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || allowed.has(url.host)) return route.continue();
    if (GOOGLE_ANALYTICS_HOSTS.includes(url.host)) {
      google.push(url.toString());
      return url.pathname === "/gtag/js" ? route.fulfill({ contentType: "text/javascript", body: "/* stand-in */" }) : route.fulfill({ status: 204 });
    }
    // Stripe's page is stood in for by stopAtStripe; anything else is a failure.
    if (url.host === "checkout.stripe.com") return route.fallback();
    outside.push(url.toString());
    return route.abort();
  });
  const events = () => commands.filter((c) => c[0] === "event").map((c) => ({ name: c[1] as string, params: c[2] as Record<string, unknown> }));
  return { commands, events, google, outside };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

test("settings, page views and search: only what's planned, and nothing personal", async ({ page, context }) => {
  const ga = await watchAnalytics(context);
  await page.goto(`${ANALYTICS}/`);
  await settle(page);

  // Google's script, from Google's tag host only, with lokl's (made-up) id.
  expect(ga.google.some((u) => u.startsWith("https://www.googletagmanager.com/gtag/js?id=G-E2ETEST000"))).toBe(true);
  // The settings, before anything is sent.
  const consent = ga.commands.find((c) => c[0] === "consent" && c[1] === "default");
  expect(consent?.[2]).toEqual({ ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
  const config = ga.commands.find((c) => c[0] === "config" && c[1] === "G-E2ETEST000");
  expect(config?.[2]).toEqual({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: 60 * 60 * 24 * 61 });
  expect(ga.commands.some((c) => c[0] === "set" && JSON.stringify(c).includes("user_id")), "no user id, ever").toBe(false);

  // A page view, with the address cleaned.
  const home = ga.events().find((e) => e.name === "page_view");
  expect(home?.params.page_location).toBe(`${ANALYTICS}/`);

  // Search, with something personal in the address: dropped.
  const from = daysFromNow(3).slice(0, 10);
  const to = daysFromNow(5).slice(0, 10);
  await page.goto(`${ANALYTICS}/atlanta/search?kind=experience&from=${from}&to=${to}&email=sam.lee%40example.com&name=Sam%20Lee`);
  await settle(page);
  const search = ga.events().find((e) => e.name === "search");
  expect(search?.params).toEqual({ market: "atlanta", kind: "experience", category: "any", area: "any", date_range_days: 3, results: expect.any(Number), transport_type: "beacon" });
  const searchView = ga.events().filter((e) => e.name === "page_view").at(-1);
  expect(searchView?.params.page_location).toBe(`${ANALYTICS}/atlanta/search?from=${from}&to=${to}&kind=experience`);

  // Only the planned events, and nothing personal anywhere.
  expect([...new Set(ga.events().map((e) => e.name))].every((n) => ["page_view", "search", "view_item", "begin_checkout", "purchase", "booking_requested"].includes(n))).toBe(true);
  expect(JSON.stringify(ga.commands)).not.toMatch(/sam\.lee|Sam Lee|@example/);
  expect(ga.outside, "nothing outside the app, lokl's Supabase and Google Analytics").toEqual([]);
});

test("a listing, Book, and coming back from Stripe: view_item, begin_checkout and purchase, with no booking id", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  const startsAt = daysFromNow(4);
  const sessionId = await data.session(listing.id, startsAt, 4);
  const ga = await watchAnalytics(context);
  await signIn(context, customer.email, customer.password);

  await page.goto(`${ANALYTICS}/experiences/${listing.slug}`);
  await settle(page);
  const view = ga.events().find((e) => e.name === "view_item");
  expect(view?.params).toEqual({
    items: [{ item_id: listing.id, item_category: "experience", item_category2: category.slug }],
    market: "atlanta", value: 50, currency: "USD", transport_type: "beacon",
  });

  // Book: begin_checkout, sent before leaving for Stripe.
  await page.locator("label").filter({ hasText: atlantaDate(startsAt) }).filter({ hasText: atlantaTime(startsAt) }).click();
  await page.getByLabel("Your name").fill("Sam Customer");
  const sentToStripe = await stopAtStripe(page);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await sentToStripe();
  await expect.poll(() => ga.events().find((e) => e.name === "begin_checkout")?.params).toEqual({
    items: [{ item_id: listing.id, item_category: "experience", item_category2: category.slug }],
    booking_mode: "experience", party_size: 1, value: 50, currency: "USD", transport_type: "beacon",
  });

  // Paid, and back from Stripe: purchase, from a neutral address.
  const paid = await data.paidBooking(customer, sessionId);
  await page.goto(`${ANALYTICS}/account/bookings/${paid.id}?checkout=done`);
  await expect.poll(() => ga.events().find((e) => e.name === "purchase")?.params).toEqual({
    items: [{ item_id: listing.id, item_category: "experience", item_category2: category.slug }],
    booking_mode: "experience", value: 50, currency: "USD",
    page_location: `${ANALYTICS}/booking-complete`, page_title: "Booking complete", transport_type: "beacon",
  });
  // The account page itself isn't measured, and no booking id or name is sent.
  expect(ga.events().some((e) => e.name === "page_view" && String(e.params.page_location).includes("/account"))).toBe(false);
  const all = JSON.stringify(ga.commands);
  expect(all).not.toContain(paid.id);
  expect(all).not.toContain("Sam Customer");
  expect(all).not.toContain(customer.email);
  expect(ga.outside).toEqual([]);
});

test("an Approve request coming back from Stripe is booking_requested", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  await data.hours(provider);
  const category = await data.category("service");
  const listing = await data.listing(provider, "service", category.id, await data.area(), undefined, "approve");
  const held = await data.heldRequest(customer, listing.id);
  const ga = await watchAnalytics(context);
  await signIn(context, customer.email, customer.password);
  await page.goto(`${ANALYTICS}/account/bookings/${held.id}?checkout=done`);
  await expect.poll(() => ga.events().find((e) => e.name === "booking_requested")?.params).toEqual({
    items: [{ item_id: listing.id, item_category: "service", item_category2: category.slug }],
    booking_mode: "approve", value: 50, currency: "USD",
    page_location: `${ANALYTICS}/booking-complete`, page_title: "Booking complete", transport_type: "beacon",
  });
  expect(JSON.stringify(ga.commands)).not.toContain(held.id);
});

test("sign-in, account and dashboard pages aren't measured: Google's script isn't even loaded", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  await data.provider(owner);
  const ga = await watchAnalytics(context);
  await page.goto(`${ANALYTICS}/login`);
  await settle(page);
  await page.goto(`${ANALYTICS}/confirm?code=123456&token_hash=abc`);
  await settle(page);
  await signIn(context, owner.email, owner.password);
  for (const path of ["/account/bookings", "/account/saved", "/dashboard", "/dashboard/help"]) {
    await page.goto(`${ANALYTICS}${path}`);
    await settle(page);
  }
  expect(ga.events(), "no events").toEqual([]);
  expect(ga.google, "no request to Google").toEqual([]);
  expect(JSON.stringify(ga.commands)).not.toContain("123456");
});

test("with Global Privacy Control, nothing is sent and Google's script isn't loaded", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  const ga = await watchAnalytics(context);
  const page = await context.newPage();
  await page.goto(`${ANALYTICS}/`);
  await settle(page);
  await page.goto(`${ANALYTICS}/atlanta/experiences`);
  await settle(page);
  expect(ga.events()).toEqual([]);
  expect(ga.google).toEqual([]);
  await context.close();
});
