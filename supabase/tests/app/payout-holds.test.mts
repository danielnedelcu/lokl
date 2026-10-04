// Payout holds after a dispute is won, and after the admin releases a hold
// (docs/architecture/booking-and-payments.md, Payouts and holds). Runs the
// pay-out job and the admin's release (server/utils/bookingJobs.ts,
// adminBookings.ts) against the LOCAL stack and the LOKL SANDBOX, with real
// test charges, a real dispute won with Stripe's test evidence, a real
// partial refund and real transfers to a connected test account.
//
// Found 2026-10-04: the job re-read Stripe's charge.disputed, which stays
// true after a dispute is won, so a won dispute's payout was held again as
// soon as the admin released it; and any released hold (a partial refund, a
// suspended provider) was put straight back for the same reason.
// Run: npx tsx supabase/tests/app/payout-holds.test.mts (part of db:test:app:stripe).

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { stripeTestKey } from "./_stripeKey";
import { handlePaymentsEvent } from "../../../apps/website/server/utils/bookings";
import { payOut } from "../../../apps/website/server/utils/bookingJobs";
import { releasePayout } from "../../../apps/website/server/utils/adminBookings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const key = stripeTestKey();
if (!/^(sk|rk)_test_/.test(key)) { console.error("Refusing to run: not a test-mode key."); process.exit(1); }
const stripe = new Stripe(key);
if ((await stripe.accounts.retrieve()).id !== "acct_1UKIdIEfG7OyQ6pv") { console.error("Refusing to run: not the Lokl sandbox."); process.exit(1); }
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
const row = async (id: string) => must(db.schema("private").from("booking_records").select("*").eq("id", id).single()) as Promise<Record<string, any>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Test-only: the booking ended yesterday and its payout is due (guard off, local database).
const endedAndDue = (id: string) => execFileSync("psql", [local.DB_URL!, "-q", "-c", `
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set starts_at = now() - interval '30 hours', ends_at = now() - interval '29 hours',
    payout_due_at = now() - interval '5 hours' where id = '${id}';
  alter table public.bookings enable trigger bookings_guard;`]);
const event = (type: string, id: string) => ({ type, data: { object: { id } } }) as unknown as Stripe.Event;
const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], category: "", area: "" };
const day = 864e5;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string, admin = false) => {
    const { user: u } = await must(db.auth.admin.createUser({
      email: `holds-${label}-${run}@test.local`, email_confirm: true, ...(admin ? { app_metadata: { role: "admin" } } : {}),
    }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const customer = await user("customer");
  const admin = await user("admin", true);
  const provider = async (label: string) => {
    const owner = await user(label);
    const id = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: `Holds ${label}`, city_id: atl.id }).select("id").single())).id as string;
    created.providers.push(id);
    await must(db.from("providers").update({ stripe_account_id: connected.id, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", id));
    return id;
  };
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Holds ${run}`, slug: `holds-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Holds ${run}` }).select("id").single())).id;
  const listing = async (providerId: string) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: providerId, city_id: atl.id, area_id: created.area, status: "submitted", kind: "experience",
      category_id: created.category, title: `Holds ${run} ${id.slice(0, 4)}`, description: "A listing made by the payout holds test.",
      price_cents: 5000, duration_minutes: 60,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${providerId}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  // A paid, confirmed booking (as Checkout leaves it), charged with `card`.
  const paidBooking = async (listingId: string, card: string) => {
    const session = (await must(db.from("experience_sessions").insert({ listing_id: listingId, starts_at: new Date(Date.now() + 2 * day).toISOString(), capacity: 4 }).select("id").single())).id;
    const b = await must(db.rpc("reserve_experience_booking", {
      p_session_id: session, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({
      amount: 5000, currency: "usd", payment_method: card, confirm: true, payment_method_types: ["card"],
      metadata: { booking_id: b.id, test: "payout-holds" },
    });
    await must(db.schema("private").from("booking_records").update({
      status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string,
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id, charge: pi.latest_charge as string };
  };
  const goodProvider = await provider("provider");
  const exp = await listing(goodProvider);

  // ---------------------------------------------------------------- 1. a won dispute
  // Stripe's test card that's disputed as soon as it's charged.
  const disputed = await paidBooking(exp, "pm_card_createDispute");
  let dispute: Stripe.Dispute | undefined;
  for (let i = 0; i < 30 && !dispute; i++) {
    dispute = (await stripe.disputes.list({ payment_intent: disputed.pi, limit: 1 })).data[0];
    if (!dispute) await sleep(2000);
  }
  if (!dispute) throw new Error("Stripe didn't open the test dispute.");
  endedAndDue(disputed.id);
  // The dispute's webhook was missed: the job finds it on the charge and holds.
  await payOut(db, stripe, { bookingId: disputed.id });
  check((await row(disputed.id)).payout_hold === "dispute", "1a. a dispute the webhook missed is found on Stripe's charge and holds the payout");

  // lokl wins it (Stripe's test evidence), and the closing webhook arrives.
  await stripe.disputes.update(dispute.id, { evidence: { uncategorized_text: "winning_evidence" }, submit: true });
  let status = dispute.status;
  for (let i = 0; i < 60 && status !== "won"; i++) {
    await sleep(3000);
    status = (await stripe.disputes.retrieve(dispute.id)).status;
  }
  if (status !== "won") throw new Error(`The test dispute didn't close as won (it's ${status}).`);
  check((await stripe.charges.retrieve(disputed.charge)).disputed === true, "1b. (Stripe keeps charge.disputed true after a dispute is won)");
  await handlePaymentsEvent(db, stripe, event("charge.dispute.closed", dispute.id));
  const won = await row(disputed.id);
  check(won.dispute_outcome === "won" && !!won.dispute_closed_at, "1c. the won dispute is recorded");

  // The admin releases the hold: it's paid out, not held again.
  await releasePayout(db, stripe, disputed.id, admin.id, "Dispute won, pay the provider.");
  const afterWon = await row(disputed.id);
  check(afterWon.status === "paid_out" && !!afterWon.stripe_transfer_id && afterWon.payout_hold === null,
    `1d. after a won dispute, releasing the hold pays the provider (status ${afterWon.status}, hold ${afterWon.payout_hold})`);

  // ---------------------------------------------------------------- 2. a lost dispute
  // Recorded as lost (no real dispute needed): the payout stays held for lokl.
  const lost = await paidBooking(exp, "pm_card_bypassPending");
  endedAndDue(lost.id);
  await must(db.schema("private").from("booking_records").update({
    stripe_dispute_id: `dp_test_${run}`, disputed_at: new Date(Date.now() - day).toISOString(), dispute_closed_at: new Date().toISOString(), dispute_outcome: "lost",
  }).eq("id", lost.id));
  await payOut(db, stripe, { bookingId: lost.id });
  const afterLost = await row(lost.id);
  check(afterLost.payout_hold === "dispute" && afterLost.status === "completed", "2a. a lost dispute holds the payout for lokl");

  // ---------------------------------------------------------------- 3. a released hold: a partial refund
  const partly = await paidBooking(exp, "pm_card_bypassPending");
  endedAndDue(partly.id);
  await stripe.refunds.create({ payment_intent: partly.pi, amount: 1000 });
  await handlePaymentsEvent(db, stripe, event("charge.refunded", partly.charge));
  await payOut(db, stripe, { bookingId: partly.id });
  check((await row(partly.id)).payout_hold === "refunded", "3a. a partial refund holds the payout");
  await releasePayout(db, stripe, partly.id, admin.id, "The refund was a goodwill gesture; pay the provider.");
  const afterRefund = await row(partly.id);
  check(afterRefund.status === "paid_out" && afterRefund.payout_hold === null,
    `3b. released, it's paid out and not held again for the refund (status ${afterRefund.status}, hold ${afterRefund.payout_hold})`);
  // A run after it changes nothing.
  await payOut(db, stripe, { bookingId: partly.id });
  check((await row(partly.id)).status === "paid_out", "3c. running the job again changes nothing");

  // ---------------------------------------------------------------- 4. a released hold: a suspended provider
  // (The same provider, suspended now: a Stripe account belongs to one provider.)
  const susBooking = await paidBooking(exp, "pm_card_bypassPending");
  const other = await paidBooking(exp, "pm_card_bypassPending");
  endedAndDue(susBooking.id);
  endedAndDue(other.id);
  await must(db.from("providers").update({ status: "suspended" }).eq("id", goodProvider));
  await payOut(db, stripe, { bookingId: susBooking.id });
  check((await row(susBooking.id)).payout_hold === "provider_suspended", "4a. a suspended provider's payout is held");
  await releasePayout(db, stripe, susBooking.id, admin.id, "Reviewed: this booking was fine, pay it.");
  const afterSus = await row(susBooking.id);
  check(afterSus.status === "paid_out" && afterSus.payout_hold === null,
    `4b. released while still suspended, it's paid out, not held again (status ${afterSus.status}, hold ${afterSus.payout_hold})`);

  // ---------------------------------------------------------------- 5. a release covers only its own reason
  await payOut(db, stripe, { bookingId: other.id });
  check((await row(other.id)).payout_hold === "provider_suspended", "5a. the same provider's other booking is held too");
  // Before the admin gets to it, the customer is partly refunded: the release is for one reason only.
  await stripe.refunds.create({ payment_intent: other.pi, amount: 500 });
  await handlePaymentsEvent(db, stripe, event("charge.refunded", other.charge));
  await releasePayout(db, stripe, other.id, admin.id, "Reviewed the suspension: fine for this booking.");
  const afterOther = await row(other.id);
  check(afterOther.payout_hold === "refunded" && afterOther.status === "completed",
    `5b. a release for the suspension doesn't cover a refund: it's held again, for the refund (hold ${afterOther.payout_hold})`);
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  // Bookings are never deleted in real use; the test removes its own rows directly.
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from booking_emails where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_finances where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_reports where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_addresses where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from admin_actions where target = 'booking' and target_id in (select id from bookings where listing_id in (${ids}));
      delete from bookings where listing_id in (${ids});
      delete from experience_sessions where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  for (const id of created.providers) await db.from("providers").delete().eq("id", id);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All payout hold checks passed.");
process.exit(failures ? 1 : 0);
