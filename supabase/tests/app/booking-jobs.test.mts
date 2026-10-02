// The timed booking jobs (docs/design/booking-and-checkout.md, Jobs; step 4
// part 5): each run twice to prove it's safe to repeat. Runs the routes' own
// code (server/utils/bookingJobs.ts) against the LOCAL stack and the LOKL
// SANDBOX (test mode only), with real test charges and real transfers to a
// connected test account. Charges use Stripe's "available balance" test card
// (pm_card_bypassPending), so a transfer never fails just because sandbox
// funds are still pending. Payouts run "as of" a later time instead of
// waiting a day.
// Run: npx tsx supabase/tests/app/booking-jobs.test.mts

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { startExperienceCheckout, handlePaymentsEvent } from "../../../apps/website/server/utils/bookings";
import { expireRequests, payOut, releaseReservations, withdrawUnavailable } from "../../../apps/website/server/utils/bookingJobs";

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
// A connected test account that can receive transfers (test mode only).
const connected = (await stripe.accounts.list({ limit: 100 })).data.find((a) => a.capabilities?.transfers === "active");
if (!connected) { console.error("Refusing to run: no connected test account in the Lokl sandbox can receive transfers."); process.exit(1); }

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const row = async (id: string) => must(db.from("bookings").select("*").eq("id", id).single()) as Promise<Record<string, any>>;
const mentions = (r: { done: string[]; failed: string[] }, id: string) => [...r.done, ...r.failed].some((l) => l.startsWith(id));
// Test-only: move a booking's times with the guard off (local database), for
// "booked hours ago" and "already started" cases.
const shift = (id: string, startsInHours: number, confirmedHoursAgo: number) => execFileSync("psql", [local.DB_URL!, "-q", "-c", `
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set starts_at = now() + interval '${startsInHours} hours', ends_at = now() + interval '${startsInHours + 1} hours',
    payout_due_at = now() + interval '${startsInHours + 25} hours', confirmed_at = now() - interval '${confirmedHoursAgo} hours' where id = '${id}';
  alter table public.bookings enable trigger bookings_guard;`]);
const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], categories: [] as string[], area: "" };
const day = 864e5;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `jobs-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const customer = await user("customer");
  const provider = async (label: string, stripeAccountId: string | null) => {
    const owner = await user(label);
    const id = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: `Jobs ${label}`, city_id: atl.id }).select("id").single())).id as string;
    created.providers.push(id);
    await must(db.from("providers").update({ stripe_account_id: stripeAccountId, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", id));
    return id;
  };
  const good = await provider("provider", connected.id);
  const noAccount = await provider("no-account", "acct_1NotARealAccount000");
  // Suspension is checked before the account, so this one needs no real account.
  const suspendable = await provider("suspendable", "acct_1NotARealAccount001");
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Jobs svc ${run}`, slug: `jobs-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Jobs exp ${run}`, slug: `jobs-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Jobs ${run}` }).select("id").single())).id;
  const listing = async (providerId: string, kind: "service" | "experience") => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: providerId, city_id: atl.id, area_id: created.area, status: "submitted", kind,
      category_id: kind === "service" ? svcCat : expCat, title: `Jobs ${kind} ${run} ${id.slice(0, 4)}`,
      description: "A listing made by the booking jobs test.", price_cents: 5000, duration_minutes: 60,
      location_mode: kind === "service" ? "provider_location" : null,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${providerId}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const svc = await listing(good, "service");
  const exp = await listing(good, "experience");
  const expNoAccount = await listing(noAccount, "experience");
  const svcSuspendable = await listing(suspendable, "service");
  const expSuspendable = await listing(suspendable, "experience");

  // A Service request with a real card hold.
  const t1 = new Date(Math.ceil((Date.now() + 3 * day) / 900_000) * 900_000).toISOString();
  const request = async (listingId: string) => {
    const b = await must(db.rpc("create_service_request", {
      p_listing_id: listingId, p_customer_id: customer.id, p_preferred_times: [t1], p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({
      amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true,
      payment_method_types: ["card"], metadata: { booking_id: b.id, test: "booking-jobs" },
    });
    await must(db.from("bookings").update({
      status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, respond_by: new Date(Date.now() + 2 * day).toISOString(),
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  };
  // A paid, confirmed Experience booking (as checkout leaves it), on a
  // session two days out; card is the test payment method to charge.
  const paidBooking = async (listingId: string, card = "pm_card_bypassPending") => {
    const session = (await must(db.from("experience_sessions").insert({ listing_id: listingId, starts_at: new Date(Date.now() + 2 * day).toISOString(), capacity: 4 }).select("id").single())).id;
    const b = await must(db.rpc("reserve_experience_booking", {
      p_session_id: session, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({
      amount: 5000, currency: "usd", payment_method: card, confirm: true, payment_method_types: ["card"],
      metadata: { booking_id: b.id, test: "booking-jobs" },
    });
    await must(db.from("bookings").update({
      status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string,
    }).eq("id", b.id));
    const r = await row(b.id);
    return { id: b.id, pi: pi.id, charge: pi.latest_charge as string, dueAt: new Date(r.payout_due_at), endsAt: new Date(r.ends_at) };
  };
  const after = (d: Date) => new Date(d.getTime() + 60_000);

  // ---------------------------------------------------------------- expire-requests
  const late = await request(svc);
  const onTime = await request(svc);
  await must(db.from("bookings").update({ respond_by: new Date(Date.now() - 60_000).toISOString() }).eq("id", late.id));
  const e1 = await expireRequests(db, stripe);
  check((await row(late.id)).status === "expired" && (await row(late.id)).status_changed_by === "system", "1a. an unanswered request past its answer-by time expires");
  check((await stripe.paymentIntents.retrieve(late.pi)).status === "canceled", "1b. ...and its card hold is released");
  check((await row(onTime.id)).status === "requested" && !mentions(e1, onTime.id), "1c. a request still in time is left alone");
  const e2 = await expireRequests(db, stripe);
  check(!mentions(e2, late.id), "1d. running it again changes nothing");

  // ---------------------------------------------------------------- release-reservations
  const sessionId = (await must(db.from("experience_sessions").insert({ listing_id: exp, starts_at: new Date(Date.now() + 5 * day).toISOString(), capacity: 1 }).select("id").single())).id;
  const open = await startExperienceCheckout({ db, stripe, siteUrl: "http://localhost:3100", customer }, { sessionId, partySize: 1, name: "Sam" });
  check((await must(db.rpc("session_spots_left", { p_session_id: sessionId }))) === 0, "2a. an open checkout holds the session's only spot");
  const r1 = await releaseReservations(db, stripe);
  check((await row(open.bookingId)).status === "pending_payment", "2b. a checkout still within its time isn't touched");
  await must(db.from("bookings").update({ reserved_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", open.bookingId));
  const r2 = await releaseReservations(db, stripe);
  check((await row(open.bookingId)).status === "expired" && mentions(r2, open.bookingId), "2c. a checkout past its time is released");
  const sessionOfOpen = (await row(open.bookingId)).stripe_checkout_session_id;
  check((await stripe.checkout.sessions.retrieve(sessionOfOpen)).status === "expired", "2d. ...Stripe has the checkout as expired, so it can't be paid now");
  check((await must(db.rpc("session_spots_left", { p_session_id: sessionId }))) === 1, "2e. ...and the spot is free");
  const r3 = await releaseReservations(db, stripe);
  check(!mentions(r3, open.bookingId) && !mentions(r1, open.bookingId), "2f. running it again changes nothing");

  // ---------------------------------------------------------------- withdraw-unavailable
  const down = await request(svcSuspendable);
  const stillLive = await request(svc);
  await must(db.from("listings").update({ status: "unpublished", unpublished_reason: "Taken down by the jobs test." }).eq("id", svcSuspendable));
  const w1 = await withdrawUnavailable(db, stripe);
  check((await row(down.id)).status === "declined" && (await row(down.id)).status_changed_by === "system", "3a. a request on a listing that came down is declined by lokl");
  check((await stripe.paymentIntents.retrieve(down.pi)).status === "canceled", "3b. ...and the card hold is released");
  check(!mentions(w1, stillLive.id) && (await row(stillLive.id)).status === "requested", "3c. a request on a live listing is left alone");
  const w2 = await withdrawUnavailable(db, stripe);
  check(!mentions(w2, down.id), "3d. running it again changes nothing");
  // A suspended provider: their open requests are withdrawn too.
  await must(db.from("listings").update({ status: "live", unpublished_reason: null }).eq("id", svcSuspendable));
  const susp = await request(svcSuspendable);
  await must(db.from("providers").update({ status: "suspended" }).eq("id", suspendable));
  await withdrawUnavailable(db, stripe);
  check((await row(susp.id)).status === "declined", "3e. a suspended provider's open requests are declined");
  await must(db.from("providers").update({ status: "active" }).eq("id", suspendable));
  for (const r of [onTime, stillLive]) await stripe.paymentIntents.cancel(r.pi);

  // ---------------------------------------------------------------- pay-out
  const paid = await paidBooking(exp);
  const p0 = await payOut(db, stripe, { bookingId: paid.id });
  check((await row(paid.id)).status === "confirmed" && !mentions(p0, paid.id), "4a. a booking that hasn't happened yet isn't touched");
  await payOut(db, stripe, { bookingId: paid.id, now: after(paid.endsAt) });
  const ended = await row(paid.id);
  check(ended.status === "completed" && !ended.stripe_transfer_id, "4b. once it has ended it's completed, but not paid until 24 hours later");
  await payOut(db, stripe, { bookingId: paid.id, now: after(paid.dueAt) });
  const done = await row(paid.id);
  check(done.status === "paid_out" && !!done.stripe_transfer_id, "4c. 24 hours after it ends, it's paid out");
  const transfer = done.stripe_transfer_id ? await stripe.transfers.retrieve(done.stripe_transfer_id) : null;
  check(transfer?.amount === done.provider_amount_cents && transfer?.destination === connected.id,
    `4d. the transfer is the provider's share ($${(done.provider_amount_cents / 100).toFixed(2)} of $50.00) to their account`);
  check(transfer?.source_transaction === paid.charge, "4e. ...linked to the original charge");
  await payOut(db, stripe, { bookingId: paid.id, now: after(paid.dueAt) });
  check((await stripe.transfers.list({ transfer_group: `booking_${paid.id}` })).data.length === 1, "4f. running it again makes no second transfer");

  // A customer who cancelled late, with no refund: the provider still gets their share.
  const lateCancel = await paidBooking(exp);
  shift(lateCancel.id, 30, 2); // inside 48 hours, booked 2 hours ago: no refund
  await must(db.from("bookings").update({ status: "cancelled", cancelled_by: "customer", status_changed_by: "customer" }).eq("id", lateCancel.id));
  await payOut(db, stripe, { bookingId: lateCancel.id, now: after(lateCancel.dueAt) });
  check((await row(lateCancel.id)).status === "paid_out", "4g. a late cancellation with no refund is still paid out");

  // Holds: each one stops the transfer and says why.
  const heldFor = async (b: { id: string; dueAt: Date }) => {
    await payOut(db, stripe, { bookingId: b.id, now: after(b.dueAt) });
    const r = await row(b.id);
    const transfers = (await stripe.transfers.list({ transfer_group: `booking_${b.id}` })).data.length;
    return { hold: r.payout_hold as string | null, status: r.status as string, transfers, failure: r.payout_failure as string | null };
  };
  const noShow = await paidBooking(exp);
  shift(noShow.id, -2, 48); // started 2 hours ago, so a problem can be reported
  await must(db.from("bookings").update({ problem_reported_at: new Date().toISOString(), problem_note: "Nobody was there." }).eq("id", noShow.id));
  const h1 = await heldFor(noShow);
  check(h1.hold === "problem_reported" && h1.status === "completed" && h1.transfers === 0, "5a. a reported no-show holds the payout");
  const h1again = await heldFor(noShow);
  check(h1again.hold === "problem_reported" && h1again.transfers === 0, "5b. ...and stays held when the job runs again");

  const refunded = await paidBooking(exp);
  await stripe.refunds.create({ payment_intent: refunded.pi, amount: 1000 });
  const h2 = await heldFor(refunded);
  check(h2.hold === "refunded" && h2.transfers === 0, "5c. a charge with a refund (seen in Stripe, before any webhook) holds the payout");

  const cantReceive = await paidBooking(expNoAccount);
  const h3 = await heldFor(cantReceive);
  check(h3.hold === "account_cannot_receive" && h3.transfers === 0 && !!h3.failure, "5d. a provider account that can't receive transfers holds the payout, with Stripe's reason");

  const suspendedPay = await paidBooking(expSuspendable);
  await must(db.from("providers").update({ status: "suspended" }).eq("id", suspendable));
  const h4 = await heldFor(suspendedPay);
  check(h4.hold === "provider_suspended" && h4.transfers === 0, "5e. a suspended provider's payout is held");
  await must(db.from("providers").update({ status: "active" }).eq("id", suspendable));

  // A real dispute: Stripe's test card that's always disputed.
  const disputed = await paidBooking(exp, "pm_card_createDispute");
  let charge = await stripe.charges.retrieve(disputed.charge);
  for (let i = 0; i < 15 && !charge.disputed; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    charge = await stripe.charges.retrieve(disputed.charge);
  }
  const disputeId = (await stripe.disputes.list({ charge: disputed.charge, limit: 1 })).data[0]?.id;
  check(!!disputeId, "6a. Stripe opened a dispute on the test charge");
  if (disputeId) {
    const said = await handlePaymentsEvent(db, stripe, { type: "charge.dispute.created", data: { object: { id: disputeId } } } as unknown as Stripe.Event);
    const d = await row(disputed.id);
    check(said === "dispute recorded, payout held" && !!d.disputed_at && d.payout_hold === "dispute", "6b. the dispute webhook records it and holds the payout");
    const h5 = await heldFor(disputed);
    check(h5.transfers === 0 && h5.status === "completed", "6c. the pay-out job makes no transfer for it");
  }
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
      delete from booking_addresses where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from experience_sessions where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  for (const id of created.providers) await db.from("providers").delete().eq("id", id);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All booking job checks passed.");
process.exit(failures ? 1 : 0);
