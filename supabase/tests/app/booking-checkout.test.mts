// Booking checkout and the payments webhook, end to end
// (docs/design/booking-and-checkout.md, step 4 part 2).
//
// Runs the routes' own code (apps/website/server/utils/bookings.ts) against
// the LOCAL stack and the LOKL SANDBOX (test mode only; refuses anything
// else). It opens a Service and an Experience checkout, writes their URLs to
// CHECKOUT_URLS_FILE and waits while they're paid with Stripe's test card
// (4242 4242 4242 4242), then feeds Stripe's real events through the webhook
// handler, once, twice and out of order. It also checks the last spot, an
// expired checkout and the webhook signature, then cleans up: the Service
// hold is released and the Experience payment refunded.
//
// Run: npx tsx supabase/tests/app/booking-checkout.test.mts

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  abandonCheckout,
  handlePaymentsEvent,
  startExperienceCheckout,
  startServiceCheckout,
  verifyPaymentsEvent,
} from "../../../apps/website/server/utils/bookings";

const LOKL_SANDBOX = "acct_1UKIdIEfG7OyQ6pv";
const URLS_FILE = process.env.CHECKOUT_URLS_FILE ?? "/tmp/lokl-checkout-urls.json";
const PAY_WAIT_MS = Number(process.env.PAY_WAIT_MINUTES ?? 10) * 60 * 1000;

// Local stack.
const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Lokl sandbox key from the website's .env (never printed).
const webEnv = Object.fromEntries(fs.readFileSync(new URL("../../../apps/website/.env", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const key = webEnv.NUXT_STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) {
  console.error("Refusing to run: the website's Stripe key isn't a test-mode key.");
  process.exit(1);
}
const stripe = new Stripe(key);
if ((await stripe.accounts.retrieve()).id !== LOKL_SANDBOX) {
  console.error("Refusing to run: the website's Stripe key isn't the Lokl sandbox's.");
  process.exit(1);
}

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const booking = async (id: string) => must(db.from("bookings").select("*").eq("id", id).single()) as Promise<Record<string, any>>;

// Every event Stripe has for a Checkout Session and its payment, oldest first.
async function eventsFor(sessionId: string, paymentIntentId?: string) {
  const out: Stripe.Event[] = [];
  for await (const e of stripe.events.list({ created: { gte: startedAt - 60 }, limit: 100 })) {
    const o = e.data.object as { id?: string; payment_intent?: string };
    if (o.id === sessionId || (paymentIntentId && (o.id === paymentIntentId || o.payment_intent === paymentIntentId))) out.push(e);
  }
  return out.reverse();
}

const startedAt = Math.floor(Date.now() / 1000);
const created = { users: [] as string[], provider: "", listings: [] as string[], category: [] as string[], area: "" };
const cleanup: (() => Promise<unknown>)[] = [];

try {
  // --- Local data: a provider with a live Service and a live Experience whose session has 1 spot.
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `checkout-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  const customer2 = await user("customer2");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Checkout Test", city_id: atl.id }).select("id").single())).id;
  // Payouts ready, or the booking routes refuse (booking-routes.test.mts covers that).
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Checkout svc ${run}`, slug: `checkout-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Checkout exp ${run}`, slug: `checkout-exp-${run}` }).select("id").single())).id;
  created.category.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Checkout ${run}` }).select("id").single())).id;
  const listing = async (row: Record<string, unknown>) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({ id, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", ...row }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const serviceId = await listing({ kind: "service", category_id: svcCat, title: `Checkout test cut ${run}`, description: "A Service made by the checkout test.", price_cents: 4500, location_mode: "provider_location", duration_minutes: 60 });
  const experienceId = await listing({ kind: "experience", category_id: expCat, title: `Checkout test walk ${run}`, description: "An Experience made by the checkout test.", price_cents: 2500, duration_minutes: 90 });
  const s1 = (await must(db.from("experience_sessions").insert({ listing_id: experienceId, starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), capacity: 1 }).select("id").single())).id;
  const s2 = (await must(db.from("experience_sessions").insert({ listing_id: experienceId, starts_at: new Date(Date.now() + 6 * 864e5).toISOString(), capacity: 1 }).select("id").single())).id;
  const ctx = (c: { id: string; email: string }) => ({ db, stripe, siteUrl: "http://localhost:3100", customer: c });

  // --- 1. Service checkout: manual capture, email prefilled, 30-minute window.
  const svc = await startServiceCheckout(ctx(customer), {
    listingId: serviceId, name: "Sam Customer", notes: "Short on top",
    preferredTimes: [new Date(Date.now() + 3 * 864e5).toISOString(), new Date(Date.now() + 4 * 864e5).toISOString()],
  });
  const svcSession = await stripe.checkout.sessions.retrieve((await booking(svc.bookingId)).stripe_checkout_session_id, { expand: ["payment_intent"] });
  check((await booking(svc.bookingId)).status === "pending_payment", "1a. the Service request is saved as pending payment");
  check(svcSession.customer_email === customer.email, "1b. Checkout has the customer's email filled in");
  check(svcSession.amount_total === 4500, "1c. Checkout charges the database's price ($45.00)");
  const svcWindow = (svcSession.expires_at - svcSession.created) / 60;
  check(svcWindow >= 30 && svcWindow <= 32, `1d. Checkout expires in about 30 minutes (${svcWindow.toFixed(0)})`);

  // --- 2. Experience checkout, and the last spot.
  const exp = await startExperienceCheckout(ctx(customer), { sessionId: s1, partySize: 1, name: "Sam Customer" });
  check((await booking(exp.bookingId)).status === "pending_payment", "2a. the Experience booking holds its spot as pending payment");
  let lastSpot = "";
  try {
    await startExperienceCheckout(ctx(customer2), { sessionId: s1, partySize: 1, name: "Alex Second" });
  } catch (e) {
    lastSpot = (e as Error).message;
  }
  check(lastSpot === "There aren't enough spots left for 1 people.", `2b. the last spot can't go to a second customer ("${lastSpot}")`);

  // --- 3. Pay both with the test card, in a browser.
  fs.writeFileSync(URLS_FILE, JSON.stringify({ service: svc.url, experience: exp.url }, null, 2));
  console.log(`Waiting for both checkouts to be paid (URLs in ${URLS_FILE}, test card 4242 4242 4242 4242)...`);
  const paid = async (bookingId: string) => {
    const b = await booking(bookingId);
    return (await stripe.checkout.sessions.retrieve(b.stripe_checkout_session_id)).status === "complete";
  };
  const until = Date.now() + PAY_WAIT_MS;
  while (Date.now() < until && !((await paid(svc.bookingId)) && (await paid(exp.bookingId)))) await sleep(3000);
  check(await paid(svc.bookingId) && await paid(exp.bookingId), "3. both checkouts were paid with the test card");

  // --- 4. Feed Stripe's real events through the handler, oldest first.
  await sleep(4000); // let Stripe write the events
  const svcBooking = await booking(svc.bookingId);
  const svcEvents = await eventsFor(svcBooking.stripe_checkout_session_id);
  const svcResults = [];
  for (const e of svcEvents) svcResults.push(`${e.type}: ${await handlePaymentsEvent(db, stripe, e)}`);
  const svcAfter = await booking(svc.bookingId);
  check(svcAfter.status === "requested", `4a. the paid Service checkout becomes a request (${svcResults.join("; ")})`);
  const pi = await stripe.paymentIntents.retrieve(svcAfter.stripe_payment_intent_id);
  check(pi.status === "requires_capture" && pi.amount_capturable === 4500, "4b. the card is on hold for $45.00, not charged");
  const respondIn = (Date.parse(svcAfter.respond_by) - Date.now()) / 36e5;
  check(respondIn > 47.5 && respondIn <= 48, `4c. the provider has 48 hours to answer (${respondIn.toFixed(1)})`);
  cleanup.push(() => stripe.paymentIntents.cancel(pi.id).catch(() => null));

  const expBooking = await booking(exp.bookingId);
  const expEvents = await eventsFor(expBooking.stripe_checkout_session_id);
  for (const e of expEvents) await handlePaymentsEvent(db, stripe, e);
  const expAfter = await booking(exp.bookingId);
  check(expAfter.status === "confirmed" && !!expAfter.stripe_charge_id, "4d. the paid Experience is confirmed, with its charge recorded");
  check(Math.abs(Date.parse(expAfter.payout_due_at) - (Date.parse(expAfter.starts_at) + 90 * 6e4 + 864e5)) < 1000,
    "4e. its payout is due 24 hours after it ends");
  cleanup.push(() => stripe.refunds.create({ payment_intent: expAfter.stripe_payment_intent_id }).catch(() => null));

  // --- 5. Duplicates and out of order change nothing.
  const eventsBefore = (await must(db.from("booking_events").select("id").in("booking_id", [svc.bookingId, exp.bookingId]))).length;
  const replays = [];
  for (const e of [...svcEvents, ...expEvents]) replays.push(await handlePaymentsEvent(db, stripe, e));
  for (const e of [...svcEvents, ...expEvents].reverse()) replays.push(await handlePaymentsEvent(db, stripe, e));
  const eventsAfter = (await must(db.from("booking_events").select("id").in("booking_id", [svc.bookingId, exp.bookingId]))).length;
  check((await booking(svc.bookingId)).status === "requested" && (await booking(exp.bookingId)).status === "confirmed",
    "5a. every event delivered again, and in reverse order, leaves both bookings as they were");
  check(eventsAfter === eventsBefore, `5b. no extra status changes were recorded (${eventsBefore} before, ${eventsAfter} after)`);
  check(replays.every((r) => r.startsWith("ignored")), `5c. the handler ignored all ${replays.length} replays`);

  // --- 6. An expired checkout releases its spots.
  const exp2 = await startExperienceCheckout(ctx(customer2), { sessionId: s2, partySize: 1, name: "Alex Second" });
  check((await must(db.rpc("session_spots_left", { p_session_id: s2 }))) === 0, "6a. the reservation takes the session's only spot");
  const exp2Session = (await booking(exp2.bookingId)).stripe_checkout_session_id;
  await stripe.checkout.sessions.expire(exp2Session);
  await sleep(3000);
  const expired = (await eventsFor(exp2Session)).filter((e) => e.type === "checkout.session.expired");
  check(expired.length === 1, "6b. Stripe sent checkout.session.expired");
  for (const e of expired) await handlePaymentsEvent(db, stripe, e);
  check((await booking(exp2.bookingId)).status === "expired", "6c. the booking is expired");
  check((await must(db.rpc("session_spots_left", { p_session_id: s2 }))) === 1, "6d. the spot is free again");
  for (const e of expired) check((await handlePaymentsEvent(db, stripe, e)).startsWith("ignored"), "6e. the expiry delivered again is ignored");

  // --- 7. Out of order across kinds: an expiry event for the paid Experience is ignored (Stripe says it's complete).
  const fakeExpired = { ...expired[0]!, data: { object: { ...(expired[0]!.data.object as object), id: expBooking.stripe_checkout_session_id } } } as Stripe.Event;
  check((await handlePaymentsEvent(db, stripe, fakeExpired)).startsWith("ignored") && (await booking(exp.bookingId)).status === "confirmed",
    "7. an expiry event naming a paid checkout is ignored; the handler goes by what Stripe says now");

  // --- 7b. Abandoning a paid checkout (the customer pressed back after paying) never touches it.
  const abandoned = await abandonCheckout(db, stripe, expBooking.stripe_checkout_session_id);
  check(abandoned.startsWith("ignored") && (await booking(exp.bookingId)).status === "confirmed",
    `7b. abandoning a paid checkout leaves the booking confirmed (${abandoned})`);

  // --- 8. The webhook signature.
  const secret = "whsec_test_" + randomBytes(12).toString("hex");
  const payload = JSON.stringify(svcEvents[0]);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  check(verifyPaymentsEvent(stripe, payload, header, secret).id === svcEvents[0]!.id, "8a. a correctly signed event is accepted");
  let refused = false;
  try { verifyPaymentsEvent(stripe, payload.replace("checkout", "Checkout"), header, secret); } catch { refused = true; }
  check(refused, "8b. a changed body is refused");
  refused = false;
  try { verifyPaymentsEvent(stripe, payload, stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" }), secret); } catch { refused = true; }
  check(refused, "8c. an event signed with another secret is refused");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  for (const c of cleanup) await c();
  // Bookings are never deleted in real use; the test removes its own rows directly.
  const L = local.DB_URL!;
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [L, "-q", "-c", `
      set session_replication_role = replica;
      delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_addresses where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from experience_sessions where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.category) await db.from("categories").delete().eq("id", id);
  fs.rmSync(URLS_FILE, { force: true });
}
console.log(failures ? `${failures} failed` : "All checkout checks passed.");
process.exit(failures ? 1 : 0);
