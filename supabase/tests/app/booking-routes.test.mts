// Booking routes without a payment (docs/design/booking-and-checkout.md):
// a provider whose Stripe account can't take charges or receive payouts can't
// be booked; abandoning an open checkout frees the booking at once; syncing a
// checkout that's still open changes nothing; an Approve Service holds the
// card and becomes a request, an Instant one charges it and is confirmed
// (docs/design/service-availability.md). Runs the routes' own code
// against the LOCAL stack and the LOKL SANDBOX (test mode only).
// Run: npx tsx supabase/tests/app/booking-routes.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { safeStripe, STRIPE_CLIENT_OPTIONS } from "@repo/types";
import { stripeTestKey } from "./_stripeKey";
import { slotAfter } from "./_slots";
import {
  abandonCheckout,
  NOT_TAKING_BOOKINGS,
  startExperienceCheckout,
  startServiceCheckout,
  syncCheckoutSession,
} from "../../../apps/website/server/utils/bookings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const key = stripeTestKey();
if (!/^(sk|rk)_test_/.test(key)) { console.error("Refusing to run: not a test-mode key."); process.exit(1); }
// Errors redacted where they happen (no key fragments in test output).
const stripe = safeStripe(new Stripe(key, STRIPE_CLIENT_OPTIONS));
if ((await stripe.accounts.retrieve()).id !== "acct_1UKIdIEfG7OyQ6pv") { console.error("Refusing to run: not the Lokl sandbox."); process.exit(1); }

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const countBookings = async (listingId: string) => (await must(db.schema("private").from("booking_records").select("id").eq("listing_id", listingId))).length;
const paidIntents: Stripe.PaymentIntent[] = [];
const created = { users: [] as string[], provider: "", listings: [] as string[], categories: [] as string[], area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `routes-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Routes Test", city_id: atl.id }).select("id").single())).id;
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Routes svc ${run}`, slug: `routes-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Routes exp ${run}`, slug: `routes-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Routes ${run}` }).select("id").single())).id;
  const listing = async (row: Record<string, unknown>) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({ id, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", ...row }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const serviceId = await listing({ kind: "service", booking_mode: "approve", category_id: svcCat, title: `Routes cut ${run}`, description: "A Service made by the routes test.", price_cents: 3000, location_mode: "provider_location", duration_minutes: 60 });
  const experienceId = await listing({ kind: "experience", category_id: expCat, title: `Routes walk ${run}`, description: "An Experience made by the routes test.", price_cents: 2000, duration_minutes: 60 });
  const s1 = (await must(db.from("experience_sessions").insert({ listing_id: experienceId, starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), capacity: 2 }).select("id").single())).id;
  const ctx = { db, stripe, siteUrl: "http://localhost:3100", customer };
  // Before payouts are ready there are no slots, so section 1 asks for a
  // quarter hour three days out (refused before the time is looked at).
  const quarterHour = new Date(Math.ceil((Date.now() + 3 * 864e5) / 900_000) * 900_000).toISOString();
  let serviceTime = quarterHour;
  const service = () => startServiceCheckout(ctx, { listingId: serviceId, name: "Sam", startsAt: serviceTime });
  const experience = () => startExperienceCheckout(ctx, { sessionId: s1, partySize: 1, name: "Sam" });
  const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };

  // 1. Payouts not ready (a new provider): both kinds refused, nothing saved.
  check((await refused(service)) === NOT_TAKING_BOOKINGS, `1a. a Service is refused while payouts aren't ready ("${NOT_TAKING_BOOKINGS}")`);
  check((await refused(experience)) === NOT_TAKING_BOOKINGS, "1b. an Experience is refused while payouts aren't ready");
  check((await countBookings(serviceId)) + (await countBookings(experienceId)) === 0, "1c. no booking is saved, and no spot held");
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: false }).eq("id", created.provider));
  check((await refused(service)) === NOT_TAKING_BOOKINGS, "1d. still refused when charges work but payouts don't");
  await must(db.from("providers").update({ stripe_charges_enabled: false, stripe_payouts_enabled: true }).eq("id", created.provider));
  check((await refused(experience)) === NOT_TAKING_BOOKINGS, "1e. still refused when payouts work but charges don't");

  // 2. Payouts ready: booking works.
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  serviceTime = await slotAfter(db, serviceId, 3 * 864e5);
  const svc = await service();
  const exp = await experience();
  check(!!svc.url && !!exp.url, "2. with payouts ready, both kinds open a checkout");
  const svcSession = (await must(db.schema("private").from("booking_records").select("stripe_checkout_session_id").eq("id", svc.bookingId).single())).stripe_checkout_session_id as string;
  const expSession = (await must(db.schema("private").from("booking_records").select("stripe_checkout_session_id").eq("id", exp.bookingId).single())).stripe_checkout_session_id as string;

  // 3. Syncing a checkout that's still open changes nothing.
  check((await syncCheckoutSession(db, stripe, svcSession)) === "ignored: checkout not complete", "3a. syncing an open checkout changes nothing");
  check((await must(db.schema("private").from("booking_records").select("status").eq("id", svc.bookingId).single())).status === "pending_payment", "3b. ...the request is still pending payment");

  // 4. Abandoning an open checkout expires it in Stripe and frees the booking at once.
  check((await must(db.rpc("session_spots_left", { p_session_id: s1 }))) === 1, "4a. the open Experience checkout holds a spot");
  check((await abandonCheckout(db, stripe, expSession)) === "expired", "4b. abandoning it expires the booking");
  check((await stripe.checkout.sessions.retrieve(expSession)).status === "expired", "4c. ...and Stripe has the checkout as expired");
  check((await must(db.rpc("session_spots_left", { p_session_id: s1 }))) === 2, "4d. ...so the spot is free straight away");
  check((await abandonCheckout(db, stripe, svcSession)) === "expired", "4e. abandoning the Service checkout frees the request too");
  check((await abandonCheckout(db, stripe, svcSession)).startsWith("ignored"), "4f. abandoning it again changes nothing");

  // 5. The two Service modes. A client of its own records what Checkout is
  // asked for, and plays back a completed checkout with a real test-mode
  // payment (tests never pay on Stripe's page; decided 2026-10-04).
  const instantId = await listing({ kind: "service", booking_mode: "instant", category_id: svcCat, title: `Routes instant cut ${run}`, description: "An Instant Service made by the routes test.", price_cents: 3000, location_mode: "provider_location", duration_minutes: 60 });
  const recorder = safeStripe(new Stripe(key, STRIPE_CLIENT_OPTIONS));
  const asked: Stripe.Checkout.SessionCreateParams[] = [];
  const realCreate = recorder.checkout.sessions.create.bind(recorder.checkout.sessions);
  recorder.checkout.sessions.create = ((params: Stripe.Checkout.SessionCreateParams, opts?: Stripe.RequestOptions) => {
    asked.push(params);
    return realCreate(params, opts);
  }) as typeof recorder.checkout.sessions.create;
  const modeCtx = { ...ctx, stripe: recorder };
  const approve = await startServiceCheckout(modeCtx, { listingId: serviceId, name: "Sam", startsAt: await slotAfter(db, serviceId, 3 * 864e5) });
  const instant = await startServiceCheckout(modeCtx, { listingId: instantId, name: "Sam", startsAt: await slotAfter(db, instantId, 3 * 864e5) });
  check(asked[0]?.payment_intent_data?.capture_method === "manual", "5a. an Approve Service's checkout only holds the card");
  check(asked[1]?.payment_intent_data?.capture_method === undefined, "5b. an Instant Service's checkout charges it at once");

  const paid = async (bookingId: string, capture: "manual" | "automatic") => {
    const sessionId = (await must(db.schema("private").from("booking_records").select("stripe_checkout_session_id").eq("id", bookingId).single())).stripe_checkout_session_id as string;
    const pi = await stripe.paymentIntents.create({
      amount: 3000, currency: "usd", capture_method: capture, payment_method: "pm_card_visa", confirm: true,
      payment_method_types: ["card"], metadata: { booking_id: bookingId, test: "booking-routes" },
    });
    paidIntents.push(pi);
    const replay = safeStripe(new Stripe(key, STRIPE_CLIENT_OPTIONS));
    replay.checkout.sessions.retrieve = (async () => ({
      id: sessionId, status: "complete", payment_status: capture === "manual" ? "unpaid" : "paid", payment_intent: pi,
    })) as unknown as typeof replay.checkout.sessions.retrieve;
    return { result: await syncCheckoutSession(db, replay, sessionId), pi };
  };
  const a = await paid(approve.bookingId, "manual");
  const ab = await must(db.schema("private").from("booking_records").select("status, respond_by, stripe_charge_id").eq("id", approve.bookingId).single());
  check(a.result === "requested" && ab.status === "requested" && !!ab.respond_by && !ab.stripe_charge_id,
    `5c. a paid Approve checkout becomes a request with the card on hold (${a.result})`);
  const i = await paid(instant.bookingId, "automatic");
  const ib = await must(db.schema("private").from("booking_records").select("status, stripe_charge_id, respond_by").eq("id", instant.bookingId).single());
  check(i.result === "confirmed" && ib.status === "confirmed" && ib.stripe_charge_id === i.pi.latest_charge && !ib.respond_by,
    `5d. a paid Instant checkout is confirmed at once, with its charge recorded (${i.result})`);
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  // Give back the test payments and close the checkouts this run opened.
  for (const pi of paidIntents) {
    if (pi.status === "requires_capture") await stripe.paymentIntents.cancel(pi.id).catch(() => null);
    else await stripe.refunds.create({ payment_intent: pi.id }).catch(() => null);
  }
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    const open = execFileSync("psql", [local.DB_URL!, "-At", "-c", `select f.stripe_checkout_session_id from booking_finances f join bookings b on b.id = f.booking_id
      where b.listing_id in (${ids}) and f.stripe_checkout_session_id is not null`], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const id of open) {
      const s = await stripe.checkout.sessions.retrieve(id).catch(() => null);
      if (s?.status === "open") await stripe.checkout.sessions.expire(id).catch(() => null);
    }
  }
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from booking_emails where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_finances where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_reports where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from experience_sessions where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All booking route checks passed.");
process.exit(failures ? 1 : 0);
