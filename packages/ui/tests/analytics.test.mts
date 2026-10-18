// What lokl sends to Google Analytics (packages/types/src/analytics.ts):
// each event keeps only its allowed keys, nothing personal planted in the
// inputs comes out, and page addresses are cleaned (the account, dashboard
// and sign-in pages aren't measured at all).
// Run: npx tsx packages/ui/tests/analytics.test.mts (part of `npm run test:ui`).
import {
  analyticsMeasures, analyticsPageLocation, beginCheckoutEvent, bookingDoneEvent, pageViewEvent, searchEvent, viewItemEvent,
  type AnalyticsEvent,
} from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const keys = (e: AnalyticsEvent) => Object.keys(e.params).sort().join(",");
const ORIGIN = "https://hilokl.com";
const LISTING = "6c1d8a52-0000-4000-8000-000000000001";
const AREA = "7d2e9b63-0000-4000-8000-000000000002";

// Personal details someone might pass in by mistake, in every field.
const EMAIL = "sam.lee@example.com";
const PHONE = "404-555-0182";
const NAME = "Sam Lee";
const leaks = (e: AnalyticsEvent) => [EMAIL, PHONE, NAME, "Sam", "Lee", "@"].some((s) => JSON.stringify(e).includes(s));

// 1. Pages.
check(!analyticsMeasures("/login") && !analyticsMeasures("/confirm") && !analyticsMeasures("/account/bookings/x") && !analyticsMeasures("/dashboard"),
  "1a. sign-in, account and dashboard pages aren't measured");
check(analyticsPageLocation(ORIGIN, "/confirm", { code: "123456", token_hash: "abc" }) === null, "1b. the sign-in link's page (its code in the address) is never sent");
check(analyticsPageLocation(ORIGIN, "/account/bookings/" + LISTING, { checkout: "done" }) === null, "1c. a booking's page is never sent");
check(analyticsPageLocation(ORIGIN, "/atlanta/search", { area: AREA, from: "2026-10-20", to: "2026-10-22", kind: "service", category: "hair", page: "2", email: EMAIL, q: NAME })
  === `${ORIGIN}/atlanta/search?area=${AREA}&from=2026-10-20&to=2026-10-22&kind=service&category=hair&page=2`,
  "1d. search keeps only its filters, each checked for its shape");
check(analyticsPageLocation(ORIGIN, "/atlanta/search", { area: EMAIL, from: PHONE, kind: NAME, category: "Sam Lee" }) === `${ORIGIN}/atlanta/search`,
  "1e. a filter that isn't the right shape is dropped");
check(analyticsPageLocation(ORIGIN, "/experiences/food-walk", { date: "2026-10-20", checkout: "cancelled", booking: LISTING }) === `${ORIGIN}/experiences/food-walk?date=2026-10-20`,
  "1f. a listing keeps only its date: never the checkout or booking settings");
check(analyticsPageLocation(ORIGIN, "/", { utm_source: "x", email: EMAIL }) === `${ORIGIN}/`, "1g. any other query is dropped");
check(analyticsPageLocation(ORIGIN, "/providers/Sam%20Lee@x", {}) === null, "1h. a path that isn't plain slugs isn't sent");
check(keys(pageViewEvent(`${ORIGIN}/`, "lokl")) === "page_location,page_title", "1i. a page view: its cleaned address and title only");

// 2. Search.
const s = searchEvent({ market: "atlanta", kind: "service", category: "hair", area: AREA, from: "2026-10-20", to: "2026-10-22", results: 14 });
check(keys(s) === "area,category,date_range_days,kind,market,results", "2a. search: market, kind, category, area, date range, results");
check(s.params.date_range_days === 3 && s.params.area === AREA && s.params.results === 14, "2b. ...a 3-day range, the area's public id, 14 results");
const sBad = searchEvent({ market: EMAIL, kind: NAME, category: PHONE, area: NAME, from: EMAIL, to: null, results: -1 });
check(sBad.params.category === "any", "2c. a phone number written like a slug (404-555-0182) isn't taken for a category");
check(!leaks(sBad) && sBad.params.kind === "all" && sBad.params.area === "any" && sBad.params.date_range_days === "any",
  "2d. anything personal in a field becomes a plain default");

// 3. A listing, checkout and the booking.
const listing = { listingId: LISTING, kind: "experience", category: "food-tours", market: "atlanta", priceCents: 4500 };
const v = viewItemEvent(listing);
check(keys(v) === "currency,items,market,value" && v.params.value === 45, "3a. view_item: the listing, market and listed price");
const b = beginCheckoutEvent({ ...listing, bookingMode: null, partySize: 3, totalCents: 13500 });
check(keys(b) === "booking_mode,currency,items,party_size,value" && b.params.party_size === 3 && b.params.booking_mode === "experience",
  "3b. begin_checkout: an Experience's people and total");
check(!("party_size" in beginCheckoutEvent({ ...listing, kind: "service", bookingMode: "approve", totalCents: 6000 }).params), "3c. ...no people count for a Service");
const done = bookingDoneEvent(ORIGIN, { ...listing, kind: "service", bookingMode: "instant", totalCents: 6000, status: "confirmed" });
check(done.name === "purchase" && keys(done) === "booking_mode,currency,items,page_location,page_title,value", "3d. purchase: no booking id (no transaction_id)");
check(done.params.page_location === `${ORIGIN}/booking-complete`, "3e. ...sent from a neutral address, not the account page");
check(bookingDoneEvent(ORIGIN, { ...listing, kind: "service", bookingMode: "approve", totalCents: 6000, status: "requested" }).name === "booking_requested",
  "3f. an Approve request is booking_requested");
const planted = [viewItemEvent({ listingId: EMAIL, kind: NAME, category: PHONE, market: NAME, priceCents: 1 }),
  beginCheckoutEvent({ listingId: NAME, kind: EMAIL, category: PHONE, bookingMode: EMAIL, partySize: 99, totalCents: 1 }),
  bookingDoneEvent(ORIGIN, { listingId: PHONE, kind: NAME, category: EMAIL, bookingMode: NAME, totalCents: 1, status: "confirmed" })];
check(planted.every((e) => !leaks(e)), "3g. personal details planted in any field never come out");

console.log(failures ? `${failures} failed` : "All analytics checks passed.");
process.exit(failures ? 1 : 0);
