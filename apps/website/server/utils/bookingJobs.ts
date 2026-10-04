// The timed booking jobs (docs/design/booking-and-checkout.md, Jobs; step 4
// part 5). Each is safe to run twice and safe to miss once: it picks up
// whatever is due, acts on what Stripe says now, and moves a booking only
// from the status it read. bookings_guard has the last word on every change
// (a paid-out booking needs its transfer, no hold and no open dispute).
//
// Plain TypeScript with no Nuxt imports, like bookings.ts: the job routes
// call it with the server key, and supabase/tests/app/booking-jobs.test.mts
// runs the same code against the local stack and the Lokl sandbox. `now` is
// a parameter so tests (and the development-only walkthrough option) can run
// a job as if at a later time.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { abandonCheckout, recordDispute } from "./bookings";
import { refundInFull } from "./bookingCancellations";
import { bookingRecords, FINANCES, withFinances } from "./bookingRecords";

export const JOB_NAMES = ["expire-requests", "release-reservations", "withdraw-unavailable", "pay-out", "review-reminders"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobResult {
  job: JobName;
  /** How many bookings were looked at. */
  checked: number;
  /** One line per booking that changed or was held: "<id>: <what happened>". */
  done: string[];
  /** One line per booking that couldn't be handled this run (tried again next run). */
  failed: string[];
}

export interface JobOptions {
  /** Treat this as the current time. Defaults to the real time. */
  now?: Date;
  /** Only this booking (the walkthrough option). */
  bookingId?: string;
}

// Idempotency keys: the booking, the action and a 10-minute window
// (CLAUDE.md: never fixed per record).
const jobKey = (bookingId: string, action: string) => `booking:${bookingId}:${action}:${Math.floor(Date.now() / 600_000)}`;

async function move(db: SupabaseClient, id: string, from: string, update: Record<string, unknown>) {
  const { data, error } = await bookingRecords(db).update(update).eq("id", id).eq("status", from).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

function result(job: JobName): JobResult {
  return { job, checked: 0, done: [], failed: [] };
}

async function each<T extends { id: string }>(r: JobResult, rows: T[], work: (row: T) => Promise<string | null>) {
  r.checked = rows.length;
  for (const row of rows) {
    try {
      const what = await work(row);
      if (what) r.done.push(`${row.id}: ${what}`);
    } catch (e) {
      console.error(`[jobs] ${r.job} ${row.id}`, e);
      r.failed.push(`${row.id}: ${(e as Error).message}`);
    }
  }
  return r;
}

// Release a Service request's card hold. Already released counts as done; a
// hold that was captured meanwhile (accepted at the same moment) is left alone.
async function releaseHold(stripe: Stripe, bookingId: string, paymentIntentId: string): Promise<"released" | "captured"> {
  try {
    await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: jobKey(bookingId, "release") });
    return "released";
  } catch (e) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "canceled") return "released";
    if (pi.status === "succeeded") return "captured";
    throw e;
  }
}

// ---------------------------------------------------------------------------
// expire-requests: no answer by the answer-by time
// ---------------------------------------------------------------------------

export async function expireRequests(db: SupabaseClient, stripe: Stripe, opts: JobOptions = {}): Promise<JobResult> {
  const now = (opts.now ?? new Date()).toISOString();
  let q = bookingRecords(db).select("id, status, stripe_payment_intent_id").eq("status", "requested").lt("respond_by", now);
  if (opts.bookingId) q = q.eq("id", opts.bookingId);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);
  return each(result("expire-requests"), data ?? [], async (b) => {
    if (b.stripe_payment_intent_id && (await releaseHold(stripe, b.id, b.stripe_payment_intent_id)) === "captured") {
      return null; // accepted at the last moment; the accept route confirms it
    }
    return (await move(db, b.id, "requested", { status: "expired", status_changed_by: "system" })) ? "expired, hold released" : null;
  });
}

// ---------------------------------------------------------------------------
// release-reservations: checkouts not paid in time
// ---------------------------------------------------------------------------

export async function releaseReservations(db: SupabaseClient, stripe: Stripe, opts: JobOptions = {}): Promise<JobResult> {
  const now = (opts.now ?? new Date()).toISOString();
  let q = bookingRecords(db).select("id, stripe_checkout_session_id").eq("status", "pending_payment").lt("reserved_until", now);
  if (opts.bookingId) q = q.eq("id", opts.bookingId);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);
  return each(result("release-reservations"), data ?? [], async (b) => {
    // No checkout was ever made (it failed while starting): nothing to ask Stripe.
    if (!b.stripe_checkout_session_id) {
      return (await move(db, b.id, "pending_payment", { status: "expired", status_changed_by: "system" })) ? "expired (no checkout)" : null;
    }
    // Expires the checkout if it's still open, then follows Stripe: a
    // checkout paid at the last moment becomes a booking, not an expiry.
    const what = await abandonCheckout(db, stripe, b.stripe_checkout_session_id);
    return what.startsWith("ignored") ? null : what;
  });
}

// ---------------------------------------------------------------------------
// withdraw-unavailable: the listing came down or the provider was suspended
// ---------------------------------------------------------------------------

type OpenBooking = {
  id: string;
  status: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  listing: { status: string; category: { active: boolean } | null; city: { active: boolean } | null } | null;
  provider: { status: string } | null;
};

/** Why a booking's listing can't be booked any more, or null if it still can. */
export function unavailableBecause(b: Pick<OpenBooking, "listing" | "provider">): string | null {
  if (b.provider?.status !== "active") return "the provider is suspended";
  if (b.listing?.status !== "live") return "the listing is no longer live";
  if (!b.listing.category?.active || !b.listing.city?.active) return "the listing's category or market is closed";
  return null;
}

export async function withdrawUnavailable(db: SupabaseClient, stripe: Stripe, opts: JobOptions = {}): Promise<JobResult> {
  let q = db
    .from("bookings")
    .select(`id, status, listing:listings(status, category:categories(active), city:cities(active)), provider:providers(status), ${FINANCES}`)
    .in("status", ["requested", "pending_payment"]);
  if (opts.bookingId) q = q.eq("id", opts.bookingId);
  const { data, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as any[]).map(withFinances).filter((b) => unavailableBecause(b)) as OpenBooking[];
  const r = await each(result("withdraw-unavailable"), rows, async (b) => {
    const why = unavailableBecause(b)!;
    if (b.status === "pending_payment") {
      if (!b.stripe_checkout_session_id) {
        return (await move(db, b.id, "pending_payment", { status: "expired", status_changed_by: "system" })) ? `expired: ${why}` : null;
      }
      // A checkout already paid becomes a request (declined on the next run)
      // or a confirmed Experience, which stays valid (decision 13).
      const what = await abandonCheckout(db, stripe, b.stripe_checkout_session_id);
      return what.startsWith("ignored") ? null : `${what} (${why})`;
    }
    if (b.stripe_payment_intent_id && (await releaseHold(stripe, b.id, b.stripe_payment_intent_id)) === "captured") return null;
    return (await move(db, b.id, "requested", { status: "declined", status_changed_by: "system" }))
      ? `declined, hold released: ${why}`
      : null;
  });

  // Confirmed bookings left on a cancelled session (the session's
  // cancellation stopped partway): refund and cancel them now.
  let left = db
    .from("bookings")
    .select(`id, kind, status, session_id, starts_at, confirmed_at, total_cents, refunded_cents, session:experience_sessions!inner(status), ${FINANCES}`)
    .eq("status", "confirmed")
    .eq("session.status", "cancelled");
  if (opts.bookingId) left = left.eq("id", opts.bookingId);
  const { data: leftRows, error: leftError } = await left.limit(200);
  if (leftError) throw new Error(leftError.message);
  const extra = result("withdraw-unavailable");
  await each(extra, ((leftRows ?? []) as any[]).map(withFinances), async (b) => {
    const refunded = await refundInFull(stripe, b);
    return (await move(db, b.id, "confirmed", {
      status: "cancelled", cancelled_by: "system", cancel_reason: "The session was cancelled.", status_changed_by: "system",
      refunded_cents: refunded, refunded_at: new Date().toISOString(),
    })) ? "cancelled with its session, refunded in full" : null;
  });
  r.checked += extra.checked;
  r.done.push(...extra.done);
  r.failed.push(...extra.failed);
  return r;
}

// ---------------------------------------------------------------------------
// pay-out: the provider's share, 24 hours after the booking ends
// ---------------------------------------------------------------------------

type PayoutBooking = {
  id: string;
  status: string;
  ends_at: string | null;
  starts_at: string | null;
  payout_due_at: string | null;
  confirmed_at: string | null;
  cancelled_by: string | null;
  refunded_cents: number;
  provider_amount_cents: number;
  problem_reported_at: string | null;
  problem_resolution: string | null;
  disputed_at: string | null;
  dispute_closed_at: string | null;
  dispute_outcome: string | null;
  payout_hold: string | null;
  payout_holds_released: string[] | null;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_transfer_id: string | null;
  provider_id: string;
  provider: { stripe_account_id: string | null; status: string } | null;
};

// From bookings, with its finances embedded (a provider join can't go
// through the private view).
const PAYOUT_FIELDS =
  "id, status, ends_at, starts_at, payout_due_at, confirmed_at, cancelled_by, refunded_cents, " +
  `problem_reported_at, problem_resolution, provider_id, provider:providers(stripe_account_id, status), ${FINANCES}`;

async function hold(db: SupabaseClient, b: PayoutBooking, reason: string, failure?: string) {
  const at = new Date().toISOString();
  const update: Record<string, unknown> = { payout_hold: reason, payout_held_at: at };
  if (failure) Object.assign(update, { payout_failed_at: at, payout_failure: failure.slice(0, 500) });
  const { error } = await bookingRecords(db).update(update).eq("id", b.id).is("payout_hold", null);
  if (error) throw new Error(error.message);
  return `held for lokl to review: ${reason}${failure ? ` (${failure.slice(0, 120)})` : ""}`;
}

/**
 * Marks bookings that have ended as completed, then pays out each one that's
 * due: a transfer of the provider's share, linked to the original charge
 * (source_transaction), so it can't move money lokl hasn't received. A
 * reported no-show, an open or lost dispute, a refund, a suspended provider,
 * or a provider account that can't receive transfers holds the payout for
 * the admin instead. A judgement the admin has released (a lost dispute, a
 * refund, a suspension) isn't held again for the same reason.
 */
export async function payOut(db: SupabaseClient, stripe: Stripe, opts: JobOptions = {}): Promise<JobResult> {
  const now = (opts.now ?? new Date()).toISOString();
  const r = result("pay-out");

  // 1. Ended bookings read as done.
  let ended = bookingRecords(db).select("id").eq("status", "confirmed").lt("ends_at", now);
  if (opts.bookingId) ended = ended.eq("id", opts.bookingId);
  const { data: endedRows, error: endedError } = await ended.limit(500);
  if (endedError) throw new Error(endedError.message);
  for (const b of endedRows ?? []) {
    if (await move(db, b.id, "confirmed", { status: "completed", status_changed_by: "system" })) r.done.push(`${b.id}: completed`);
  }

  // 2. Due payouts: completed, or cancelled late by the customer with no
  // refund (the provider keeps their share), with nothing held.
  let due = db
    .from("bookings")
    .select(PAYOUT_FIELDS)
    .in("status", ["completed", "cancelled"])
    .lte("payout_due_at", now)
    .is("finances.stripe_transfer_id", null)
    .is("finances.payout_hold", null);
  if (opts.bookingId) due = due.eq("id", opts.bookingId);
  const { data: dueRows, error: dueError } = await due.limit(200);
  if (dueError) throw new Error(dueError.message);
  const rows = ((dueRows ?? []) as any[]).map(withFinances).filter(
    (b) => b.status === "completed" || (b.cancelled_by === "customer" && b.refunded_cents === 0 && b.confirmed_at),
  );

  // each() adds to r.done, after the "completed" lines above.
  await each(r, rows, async (b) => payOne(db, stripe, b));
  r.checked = (endedRows?.length ?? 0) + rows.length;
  return r;
}

/**
 * A dispute's hold, judged by the outcome recorded on the booking (from
 * Stripe's dispute, recordDispute), never by Stripe's charge.disputed, which
 * stays true after lokl wins: open always holds (it can't be released), lost
 * holds unless the admin released it, won or closed as a warning doesn't.
 */
function disputeHold(b: Pick<PayoutBooking, "disputed_at" | "dispute_closed_at" | "dispute_outcome">, released: Set<string>) {
  if (!b.disputed_at) return null;
  if (!b.dispute_closed_at) return "open";
  if (b.dispute_outcome === "lost" && !released.has("dispute")) return "lost";
  return null;
}

async function payOne(db: SupabaseClient, stripe: Stripe, b: PayoutBooking): Promise<string> {
  // What the admin has already released: those judgements don't hold it again.
  const released = new Set(b.payout_holds_released ?? []);
  // Holds the database knows about.
  // A report holds the payout until lokl resolves it in the provider's favour.
  if (b.problem_reported_at && b.problem_resolution !== "paid_provider") return hold(db, b, "problem_reported");
  if (disputeHold(b, released)) return hold(db, b, "dispute");
  if (b.refunded_cents > 0 && !released.has("refunded")) return hold(db, b, "refunded");
  // A suspended provider's money waits for lokl's review (suspension can
  // mean fraud).
  if (b.provider?.status !== "active" && !released.has("provider_suspended")) return hold(db, b, "provider_suspended");
  if (!b.stripe_charge_id) throw new Error("no charge recorded for this booking");

  // What Stripe says now, in case a webhook was missed: a dispute or refund
  // on the charge, and whether the provider's account can receive transfers.
  const charge = await stripe.charges.retrieve(b.stripe_charge_id);
  if (charge.disputed && !b.disputed_at) {
    // A dispute the webhook missed: record it as Stripe has it, then judge it
    // like any other. (No dispute found yet: hold until it can be recorded.)
    const dispute = b.stripe_payment_intent_id
      ? (await stripe.disputes.list({ payment_intent: b.stripe_payment_intent_id, limit: 1 })).data[0]
      : undefined;
    if (!dispute) return hold(db, b, "dispute");
    await recordDispute(db, stripe, dispute.id);
    const { data: fresh, error } = await bookingRecords(db).select("disputed_at, dispute_closed_at, dispute_outcome, payout_hold").eq("id", b.id).single();
    if (error) throw new Error(error.message);
    if (fresh.payout_hold) return `held for lokl to review: ${fresh.payout_hold} (found on Stripe's charge)`;
    if (disputeHold(fresh, released)) return hold(db, b, "dispute");
  }
  if (charge.amount_refunded > 0 && !released.has("refunded")) return hold(db, b, "refunded");
  const accountId = b.provider?.stripe_account_id;
  if (!accountId) return hold(db, b, "account_cannot_receive", "The provider has no Stripe account.");
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(accountId);
  } catch (e) {
    // Stripe says the account doesn't exist or isn't connected to lokl.
    const type = (e as Stripe.errors.StripeError).type;
    if (type === "StripeInvalidRequestError" || type === "StripePermissionError") {
      return hold(db, b, "account_cannot_receive", (e as Error).message);
    }
    throw e;
  }
  if (account.capabilities?.transfers !== "active") {
    return hold(db, b, "account_cannot_receive", `Transfers are ${account.capabilities?.transfers ?? "not set up"} on the provider's Stripe account.`);
  }

  // One transfer per booking, ever: look for an earlier one first (a run
  // that transferred but didn't get to record it), then create it.
  const group = `booking_${b.id}`;
  let transfer = (await stripe.transfers.list({ transfer_group: group, limit: 1 })).data[0];
  if (!transfer) {
    try {
      transfer = await stripe.transfers.create(
        {
          amount: b.provider_amount_cents,
          currency: "usd",
          destination: accountId,
          source_transaction: b.stripe_charge_id,
          transfer_group: group,
          description: "lokl booking payout",
          metadata: { booking_id: b.id, provider_id: b.provider_id },
        },
        { idempotencyKey: jobKey(b.id, "transfer") },
      );
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      // Stripe answered and said no: hold it for the admin. Anything else
      // (a timeout, Stripe down) is tried again next run.
      if (err.type === "StripeInvalidRequestError" || err.type === "StripePermissionError") {
        return hold(db, b, "transfer_failed", err.message);
      }
      throw e;
    }
  }

  const { data, error } = await bookingRecords(db)
    .update({ status: "paid_out", stripe_transfer_id: transfer.id, status_changed_by: "system" })
    .eq("id", b.id)
    .eq("status", b.status)
    .is("stripe_transfer_id", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length ? `paid out ${b.provider_amount_cents} cents (${transfer.id})` : "already paid out";
}

export async function runJob(name: JobName, db: SupabaseClient, stripe: Stripe, opts: JobOptions = {}) {
  switch (name) {
    case "expire-requests": return expireRequests(db, stripe, opts);
    case "release-reservations": return releaseReservations(db, stripe, opts);
    case "withdraw-unavailable": return withdrawUnavailable(db, stripe, opts);
    case "pay-out": return payOut(db, stripe, opts);
    case "review-reminders": return reviewReminders(db, opts);
  }
}

/**
 * Queues the one review reminder (docs/design/reviews.md, Emails): for each
 * booking 10 to 14 days past its end that could still be reviewed and
 * hasn't been. The database decides which and queues them once
 * (queue_review_reminders); the route then sends them. No Stripe.
 */
async function reviewReminders(db: SupabaseClient, opts: JobOptions) {
  // It works on every booking at once: a one-booking run (the development
  // option) would queue other bookings' reminders as of a made-up time.
  if (opts.bookingId) throw new Error("review-reminders runs for every booking; it can't be limited to one.");
  const { data, error } = await db.rpc("queue_review_reminders", opts.now ? { p_now: opts.now.toISOString() } : {});
  if (error) throw new Error(error.message);
  const n = (data as number | null) ?? 0;
  return { job: "review-reminders", checked: n, done: n ? [`queued ${n} review ${n === 1 ? "reminder" : "reminders"}`] : [], failed: [] as string[] };
}
