// Cancellations, refunds and no-show reports (docs/design/booking-and-
// checkout.md; step 4 part 6), with the 1-hour grace period. Runs the
// routes' own code (server/utils/bookingCancellations.ts) against the LOCAL
// stack and the LOKL SANDBOX (test mode only), with real charges and real
// refunds. Cases that need a booking already started, or booked hours ago,
// have their times moved directly in the local database with the rules
// switched off, as only a test can.
// Run: npx tsx supabase/tests/app/cancellations.test.mts

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { customerCancelOutcome } from "../../../packages/types/src/bookings";
import { startExperienceCheckout } from "../../../apps/website/server/utils/bookings";
import { cancelSession, customerCancel, providerCancel, reportProblem } from "../../../apps/website/server/utils/bookingCancellations";
import { withdrawUnavailable } from "../../../apps/website/server/utils/bookingJobs";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const webEnv = Object.fromEntries(fs.readFileSync(new URL("../../../apps/website/.env", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const key = webEnv.NUXT_STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) { console.error("Refusing to run: not a test-mode key."); process.exit(1); }
const stripe = new Stripe(key);
if ((await stripe.accounts.retrieve()).id !== "acct_1UKIdIEfG7OyQ6pv") { console.error("Refusing to run: not the Lokl sandbox."); process.exit(1); }

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };
const row = async (id: string) => must(db.from("bookings").select("*").eq("id", id).single()) as Promise<Record<string, any>>;
const refundedInStripe = async (pi: string) => (await stripe.charges.list({ payment_intent: pi })).data[0]?.amount_refunded ?? -1;
const refundCount = async (pi: string) => (await stripe.refunds.list({ payment_intent: pi })).data.length;
// Test-only: move a booking's times with the guard off (local database).
const shift = (id: string, startsInHours: number, confirmedHoursAgo: number) => execFileSync("psql", [local.DB_URL!, "-q", "-c", `
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set starts_at = now() + interval '${startsInHours} hours', ends_at = now() + interval '${startsInHours + 1} hours',
    payout_due_at = now() + interval '${startsInHours + 25} hours', confirmed_at = now() - interval '${confirmedHoursAgo} hours' where id = '${id}';
  alter table public.bookings enable trigger bookings_guard;`]);
const created = { users: [] as string[], provider: "", listings: [] as string[], categories: [] as string[], area: "" };
const day = 864e5;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `cancel-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Cancel Test", city_id: atl.id }).select("id").single())).id;
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Cancel svc ${run}`, slug: `cancel-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Cancel exp ${run}`, slug: `cancel-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Cancel ${run}` }).select("id").single())).id;
  const listing = async (kind: "service" | "experience") => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", kind,
      category_id: kind === "service" ? svcCat : expCat, title: `Cancel ${kind} ${run}`, description: "A listing made by the cancellations test.",
      price_cents: 5000, duration_minutes: 60, location_mode: kind === "service" ? "provider_location" : null,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const svc = await listing("service");
  const exp = await listing("experience");
  const session = async (startsInHours: number, capacity = 6) =>
    (await must(db.from("experience_sessions").insert({ listing_id: exp, starts_at: new Date(Date.now() + startsInHours * 3600_000).toISOString(), capacity }).select("id").single())).id as string;
  // A paid Experience booking, as checkout leaves it.
  const paid = async (sessionId: string) => {
    const b = await must(db.rpc("reserve_experience_booking", {
      p_session_id: sessionId, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({
      amount: 5000, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, payment_method_types: ["card"],
      metadata: { booking_id: b.id, test: "cancellations" },
    });
    await must(db.from("bookings").update({ status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  };

  // 0. The policy itself, at its edges.
  const start = Date.parse("2026-11-10T18:00:00Z");
  const at = (h: number) => start - h * 3600_000;
  const booked = (hoursBefore: number) => new Date(start - hoursBefore * 3600_000).toISOString();
  const o = (now: number, bookedAt: string) => customerCancelOutcome({ status: "confirmed", starts_at: new Date(start).toISOString(), confirmed_at: bookedAt }, now).kind;
  check(o(at(48), booked(100)) === "full_refund" && o(at(47.9), booked(100)) === "no_refund", "0a. exactly 48 hours ahead is a full refund; just inside 48 hours isn't");
  check(o(at(30), booked(30.5)) === "full_refund" && o(at(29), booked(30.5)) === "no_refund", "0b. within an hour of booking is a full refund (the grace period); after the hour it isn't");
  check(o(start, booked(0.5)) === "not_allowed", "0c. once it starts, even inside the grace hour, it can't be cancelled");
  check(customerCancelOutcome({ status: "requested", starts_at: null, confirmed_at: null }).kind === "release", "0d. a request not yet accepted is free to cancel");

  // 1. A request: free, the hold released.
  const reqId = (await must(db.rpc("create_service_request", {
    p_listing_id: svc, p_customer_id: customer.id, p_preferred_times: [new Date(Date.now() + 3 * day).toISOString()], p_customer_name: "Sam",
    p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null,
    p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
  })) as { id: string }).id;
  const hold = await stripe.paymentIntents.create({ amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true, payment_method_types: ["card"] });
  await must(db.from("bookings").update({ status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: hold.id, respond_by: new Date(Date.now() + 2 * day).toISOString() }).eq("id", reqId));
  check((await customerCancel(db, stripe, reqId)) === "cancelled, hold released", "1a. cancelling a request releases the hold");
  check((await stripe.paymentIntents.retrieve(hold.id)).status === "canceled" && (await row(reqId)).status === "cancelled", "1b. ...nothing is charged, and it's cancelled");

  // 2. 48 hours or more ahead: everything back, once.
  const ahead = await paid(await session(72));
  check((await customerCancel(db, stripe, ahead.id)) === "cancelled, refunded in full", "2a. cancelling 3 days ahead refunds in full");
  check((await refundedInStripe(ahead.pi)) === 5000 && (await row(ahead.id)).refunded_cents === 5000, "2b. ...$50.00 back in Stripe and on the booking");
  check((await customerCancel(db, stripe, ahead.id)) === "already cancelled" && (await refundCount(ahead.pi)) === 1, "2c. cancelling again refunds nothing more");

  // 3. The grace period: inside 48 hours, but just booked.
  const grace = await paid(await session(30));
  check((await customerCancel(db, stripe, grace.id)) === "cancelled, refunded in full" && (await refundedInStripe(grace.pi)) === 5000,
    "3. booked inside 48 hours and cancelled within the hour: refunded in full");

  // 4. Late: inside 48 hours, booked 2 hours ago. No refund; spots freed.
  const lateSession = await session(30, 1);
  const late = await paid(lateSession);
  shift(late.id, 30, 2);
  check((await must(db.rpc("session_spots_left", { p_session_id: lateSession }))) === 0, "4a. the booking holds the session's only spot");
  check((await customerCancel(db, stripe, late.id)) === "cancelled, no refund", "4b. cancelling inside 48 hours, after the grace hour, gets no refund");
  check((await refundedInStripe(late.pi)) === 0 && (await row(late.id)).refunded_cents === 0, "4c. ...nothing is refunded");
  check((await must(db.rpc("session_spots_left", { p_session_id: lateSession }))) === 1, "4d. ...and the spot is free again");

  // 5. Started: the customer can't cancel (they report a problem instead).
  const started = await paid(await session(72));
  shift(started.id, -1, 48);
  check((await refused(() => customerCancel(db, stripe, started.id))) === "This booking has started, so it can't be cancelled.", "5. a booking that has started can't be cancelled");

  // 6. The provider cancels: a full refund, and the customer sees why.
  const byProvider = await paid(await session(30));
  shift(byProvider.id, 30, 5);
  check((await providerCancel(db, stripe, byProvider.id, "I'm unwell that day, sorry.")) === "cancelled, refunded in full", "6a. the provider cancels inside 48 hours");
  const pc = await row(byProvider.id);
  check((await refundedInStripe(byProvider.pi)) === 5000 && pc.cancelled_by === "provider" && pc.cancel_reason === "I'm unwell that day, sorry.",
    "6b. ...the customer is refunded in full, with the provider's reason recorded");

  // 7. The provider cancels a whole session: everyone refunded, open checkouts expired.
  const big = await session(96, 5);
  const one = await paid(big);
  const two = await paid(big);
  const open = await startExperienceCheckout({ db, stripe, siteUrl: "http://localhost:3100", customer }, { sessionId: big, partySize: 1, name: "Sam" });
  const s1 = await cancelSession(db, stripe, big, "The venue closed for repairs.");
  check(s1.length === 3, `7a. cancelling the session handles all 3 bookings (${s1.length})`);
  check((await refundedInStripe(one.pi)) === 5000 && (await refundedInStripe(two.pi)) === 5000, "7b. both paid bookings are refunded in full");
  check((await row(one.id)).cancel_reason === "The venue closed for repairs.", "7c. ...with the provider's reason");
  const openSession = (await row(open.bookingId)).stripe_checkout_session_id;
  check((await row(open.bookingId)).status === "expired" && (await stripe.checkout.sessions.retrieve(openSession)).status === "expired",
    "7d. the checkout in progress is expired, so it can't be paid now");
  check((await must(db.from("experience_sessions").select("status").eq("id", big).single())).status === "cancelled", "7e. the session is cancelled");
  await cancelSession(db, stripe, big, "The venue closed for repairs.");
  check((await refundCount(one.pi)) === 1 && (await refundCount(two.pi)) === 1, "7f. cancelling it again refunds nothing more");

  // 8. The safety net: a session cancelled with a booking left on it.
  const partial = await session(96, 2);
  const leftOver = await paid(partial);
  await must(db.from("experience_sessions").update({ status: "cancelled" }).eq("id", partial));
  await withdrawUnavailable(db, stripe, { bookingId: leftOver.id });
  const lo = await row(leftOver.id);
  check(lo.status === "cancelled" && lo.cancelled_by === "system" && (await refundedInStripe(leftOver.pi)) === 5000,
    "8. the jobs refund and cancel a booking left on a cancelled session");

  // 9. "The provider didn't show up".
  const show = await paid(await session(72));
  check((await refused(() => reportProblem(db, show.id, "Nobody was there at all."))) === "A problem can be reported from the start of a booking until its payout.",
    "9a. a problem can't be reported before the booking starts");
  shift(show.id, -2, 48);
  check((await reportProblem(db, show.id, "Nobody was there at all.")) === "reported", "9b. after the start, the customer reports it");
  const rp = await row(show.id);
  check(rp.payout_hold === "problem_reported" && !!rp.payout_held_at, "9c. ...the payout is held at once");
  const notes = await must(db.from("notifications").select("kind").eq("booking_id", show.id));
  check(notes.some((n: { kind: string }) => n.kind === "booking_problem_reported"), "9d. ...and the provider's bell says a problem was reported");
  check((await refused(() => reportProblem(db, show.id, "Still nobody there, again."))) === "A problem has already been reported on this booking.", "9e. it's reported once");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
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
console.log(failures ? `${failures} failed` : "All cancellation checks passed.");
process.exit(failures ? 1 : 0);
