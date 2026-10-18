// Cancellations, refunds and no-show reports (docs/design/booking-and-
// checkout.md; step 4 part 6). The policy is customerCancelOutcome() in
// @repo/types, which the pages show before anyone confirms; bookings_guard
// enforces the same rules, so the database refuses a cancellation that
// doesn't match its refund.
//
// Plain TypeScript with no Nuxt imports, like bookings.ts: routes call it
// with the server key after checking who's asking, and
// supabase/tests/app/cancellations.test.mts runs the same code against the
// local stack and the Lokl sandbox. Refunds happen in Stripe first, then the
// booking is moved, only from the status read; a retry refunds once. Each
// refund carries its meaning (CancelMeaning), so a cancellation whose reply
// was lost is finished from Stripe (finishLostCancel).

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customerCancelOutcome, logText } from "@repo/types";
import { abandonCheckout, BookingError } from "./bookings";
import { bookingRecords, FINANCES, withFinances } from "./bookingRecords";

interface CancelRow {
  id: string;
  kind: "service" | "experience";
  status: string;
  session_id: string | null;
  starts_at: string | null;
  confirmed_at: string | null;
  total_cents: number;
  refunded_cents: number;
  stripe_payment_intent_id: string | null;
}

/**
 * What a refund or a released hold means for lokl, written to Stripe (the
 * refund's or the PaymentIntent's metadata) before the call, so that when
 * the reply is lost, a retry, Stripe's webhook or a job can finish the
 * action from Stripe alone (the lost-reply check, 2026-10-11). The reason
 * stays in lokl: it's saved on the booking (cancel_reason) first.
 */
export interface CancelMeaning {
  lokl_action: "cancel" | "cancel_session";
  cancelled_by: "customer" | "provider" | "admin" | "system";
  /** For lokl's cancellations: the admin, for the admin log. */
  admin_id?: string;
  /** "true" when lokl refunds to resolve a no-show report. */
  resolve_problem?: "true";
}

// real time: Stripe's idempotency-key window, on Stripe's clock.
const key = (bookingId: string, action: string) => `booking:${bookingId}:${action}:${Math.floor(Date.now() / 600_000)}`;

async function read(db: SupabaseClient, id: string) {
  const { data, error } = await bookingRecords(db).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as CancelRow & Record<string, unknown>;
}

async function move(db: SupabaseClient, id: string, from: string, update: Record<string, unknown>) {
  const { data, error } = await bookingRecords(db).update(update).eq("id", id).eq("status", from).select("id");
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    throw new Error(error.message);
  }
  return (data ?? []).length > 0;
}

/** Saves why a booking is being cancelled, before the refund (so a lost reply can be finished with it). */
export async function saveCancelReason(db: SupabaseClient, id: string, from: string, reason: string) {
  const { error } = await bookingRecords(db).update({ cancel_reason: reason }).eq("id", id).eq("status", from);
  if (error) throw new Error(error.message);
}

/**
 * Refunds whatever of the booking's charge isn't refunded yet, with what the
 * refund means. Reads the charge first, so a second call (a retry, a double
 * click) refunds nothing, and treats Stripe's "already refunded" refusal as
 * done once the charge, read again, is refunded. Returns the total now
 * refunded, in cents.
 */
export async function refundInFull(stripe: Stripe, b: CancelRow, meaning?: CancelMeaning): Promise<number> {
  if (!b.stripe_payment_intent_id) throw new Error(`booking ${b.id} has no payment`);
  const pi = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id, { expand: ["latest_charge"] });
  const charge = pi.latest_charge as Stripe.Charge | null;
  if (!charge || pi.status !== "succeeded") throw new Error(`booking ${b.id}'s payment is ${pi.status}`);
  const owed = Math.min(b.total_cents, charge.amount);
  const left = owed - charge.amount_refunded;
  if (left > 0) {
    try {
      await stripe.refunds.create(
        { payment_intent: pi.id, amount: left, reason: "requested_by_customer", metadata: { booking_id: b.id, ...meaning } },
        { idempotencyKey: key(b.id, `refund-${left}`) },
      );
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      if (err.type !== "StripeInvalidRequestError") throw e;
      const now = await stripe.charges.retrieve(charge.id);
      if (now.amount_refunded < owed) throw e;
    }
  }
  return owed;
}

/**
 * Marks what releasing a request's hold means, then releases it. The meaning
 * goes under its own key (lokl_release), never lokl_action, so a release
 * tried after a capture (an accept whose reply was lost) can't erase what
 * the capture meant.
 */
export async function releaseHold(stripe: Stripe, b: { id: string; stripe_payment_intent_id: string | null }, meaning?: Record<string, string>) {
  if (!b.stripe_payment_intent_id) return;
  try {
    if (meaning) await stripe.paymentIntents.update(b.stripe_payment_intent_id, { metadata: meaning });
    await stripe.paymentIntents.cancel(b.stripe_payment_intent_id, {}, { idempotencyKey: key(b.id, "release") });
  } catch (e) {
    const pi = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id);
    if (pi.status !== "canceled") throw e;
  }
}

/**
 * Takes the provider's share back after a payout. Reads the transfer first,
 * so a retry reverses nothing more, and treats Stripe's "already reversed"
 * refusal as done. A failure (usually an empty balance) is returned, to be
 * recorded as money owed, not thrown.
 */
export async function reverseTransfer(stripe: Stripe, b: Record<string, any>): Promise<{ id: string } | { failure: string }> {
  const reversed = async (transferId: string) => {
    const existing = (await stripe.transfers.listReversals(transferId, { limit: 1 })).data[0];
    return { id: existing?.id ?? `${transferId}:reversed` };
  };
  const transfer = await stripe.transfers.retrieve(b.stripe_transfer_id);
  const left = transfer.amount - transfer.amount_reversed;
  if (left <= 0) return reversed(transfer.id);
  try {
    const reversal = await stripe.transfers.createReversal(
      transfer.id,
      { amount: left, metadata: { booking_id: b.id } },
      { idempotencyKey: key(b.id, "reverse") },
    );
    return { id: reversal.id };
  } catch (e) {
    const err = e as Stripe.errors.StripeError;
    if (err.type === "StripeInvalidRequestError") {
      const now = await stripe.transfers.retrieve(transfer.id);
      if (now.amount_reversed >= now.amount) return reversed(transfer.id);
    }
    if (err.type === "StripeInvalidRequestError" || err.type === "StripePermissionError") return { failure: logText(err.message, 500) };
    throw e;
  }
}

/** lokl's cancellation, recorded with its admin log in one transaction (admin_cancel_booking). */
export async function recordAdminCancel(
  db: SupabaseClient,
  a: {
    bookingId: string; adminId: string; reason: string; from: string; resolveProblem: boolean;
    refundedCents: number | null; cancelledAt?: string | null; reversalId?: string | null; reversalFailure?: string | null;
  },
): Promise<"cancelled" | "already cancelled" | "logged" | "changed"> {
  const { data, error } = await db.rpc("admin_cancel_booking", {
    p_booking_id: a.bookingId, p_admin_id: a.adminId, p_reason: a.reason, p_from: a.from, p_resolve_problem: a.resolveProblem,
    p_refunded_cents: a.refundedCents, p_cancelled_at: a.cancelledAt ?? null,
    p_reversal_id: a.reversalId ?? null, p_reversal_failure: a.reversalFailure ?? null,
  });
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    if (error.code === "P0002") throw new BookingError("We couldn't find that booking.", 404);
    throw new Error(error.message);
  }
  return data as "cancelled" | "already cancelled" | "logged" | "changed";
}

/**
 * Finishes a cancellation whose refund Stripe made but whose booking was
 * never moved (the reply was lost): from the refund's meaning, at the time
 * Stripe made it. Returns what it did, or null when the booking has no such
 * refund (or isn't fully refunded yet), so the caller carries on as usual.
 * Used by the cancel actions' retries and by the charge.refunded webhook.
 */
export async function finishLostCancel(db: SupabaseClient, stripe: Stripe, b: CancelRow & Record<string, any>): Promise<string | null> {
  if (!["confirmed", "completed", "paid_out"].includes(b.status) || !b.stripe_payment_intent_id) return null;
  // bounded: one payment's refunds (lokl refunds a booking once, in full)
  const refunds = (await stripe.refunds.list({ payment_intent: b.stripe_payment_intent_id, limit: 20 })).data;
  const refund = refunds
    .filter((r) => ["cancel", "cancel_session"].includes(r.metadata?.lokl_action ?? "") && !["failed", "canceled"].includes(r.status ?? ""))
    .sort((x, y) => x.created - y.created)[0];
  if (!refund) return null;
  const meaning = refund.metadata as unknown as CancelMeaning;
  const charge = await stripe.charges.retrieve(refund.charge as string);
  const owed = Math.min(b.total_cents, charge.amount);
  if (charge.amount_refunded < owed) return null;
  // Stripe's times are whole seconds, and the database's have microseconds
  // (a millisecond is added): never before the booking was confirmed.
  const at = new Date(Math.max(refund.created * 1000, Date.parse(b.confirmed_at ?? b.created_at) + 1)).toISOString();

  if (meaning.cancelled_by === "admin") {
    if (!meaning.admin_id) return null;
    let reversal: { id: string } | { failure: string } | null = null;
    if (b.status === "paid_out") reversal = await reverseTransfer(stripe, b);
    const done = await recordAdminCancel(db, {
      bookingId: b.id, adminId: meaning.admin_id, reason: (b.cancel_reason as string | null) ?? "Cancelled by lokl (the reason wasn't saved).",
      from: b.status, resolveProblem: meaning.resolve_problem === "true", refundedCents: owed, cancelledAt: at,
      reversalId: reversal && "id" in reversal ? reversal.id : null, reversalFailure: reversal && "failure" in reversal ? reversal.failure : null,
    });
    return done === "changed" ? null : "cancelled and refunded";
  }
  const moved = await move(db, b.id, b.status, {
    status: "cancelled", cancelled_by: meaning.cancelled_by, status_changed_by: meaning.cancelled_by,
    refunded_cents: owed, refunded_at: at, cancelled_at: at,
  });
  return moved ? "cancelled, refunded in full" : null;
}

/** The customer cancels: free for a request, then by the policy. */
export async function customerCancel(db: SupabaseClient, stripe: Stripe, bookingId: string) {
  const b = await read(db, bookingId);
  if (b.status === "cancelled" && b.cancelled_by === "customer") return "already cancelled";
  // Refunded already, the reply lost: finish it, by the policy at the time of the refund.
  const lost = await finishLostCancel(db, stripe, b);
  if (lost) return lost;
  const meaning: CancelMeaning = { lokl_action: "cancel", cancelled_by: "customer" };
  const outcome = customerCancelOutcome(b);
  switch (outcome.kind) {
    case "not_allowed":
      throw new BookingError(outcome.why, 409);
    case "release":
      await releaseHold(stripe, b, { lokl_release: "cancel", cancelled_by: "customer" });
      return (await move(db, b.id, "requested", { status: "cancelled", cancelled_by: "customer", status_changed_by: "customer" }))
        ? "cancelled, hold released" : "already cancelled";
    case "full_refund": {
      const refunded = await refundInFull(stripe, b, meaning);
      return (await move(db, b.id, "confirmed", {
        status: "cancelled", cancelled_by: "customer", status_changed_by: "customer",
        // real time: when it happened (a record).
        refunded_cents: refunded, refunded_at: new Date().toISOString(),
      })) ? "cancelled, refunded in full" : "already cancelled";
    }
    case "no_refund":
      return (await move(db, b.id, "confirmed", { status: "cancelled", cancelled_by: "customer", status_changed_by: "customer" }))
        ? "cancelled, no refund" : "already cancelled";
  }
}

/** The provider cancels a confirmed booking before it starts: always a full refund, with their reason. */
export async function providerCancel(db: SupabaseClient, stripe: Stripe, bookingId: string, reason: string) {
  const b = await read(db, bookingId);
  if (b.status === "cancelled" && b.cancelled_by === "provider") return "already cancelled";
  // Refunded before the start, the reply lost: finish it, even after the start.
  const lost = await finishLostCancel(db, stripe, b);
  if (lost) return lost;
  if (b.status !== "confirmed") throw new BookingError("Only a confirmed booking can be cancelled. Decline a request instead.", 409);
  // real time: a rule the database checks too (a started booking can't be cancelled).
  if (b.starts_at && Date.now() >= Date.parse(b.starts_at)) throw new BookingError("This booking has started, so it can't be cancelled.", 409);
  await saveCancelReason(db, b.id, "confirmed", reason);
  const refunded = await refundInFull(stripe, b, { lokl_action: "cancel", cancelled_by: "provider" });
  return (await move(db, b.id, "confirmed", {
    status: "cancelled", cancelled_by: "provider", cancel_reason: reason, status_changed_by: "provider",
    // real time: when it happened (a record).
    refunded_cents: refunded, refunded_at: new Date().toISOString(),
  })) ? "cancelled, refunded in full" : "already cancelled";
}

/**
 * The provider cancels a whole session: the session first (so nobody can
 * book it meanwhile), then every booking on it, refunded in full. Safe to
 * run again: what's done stays done. If Stripe fails partway, the
 * withdraw-unavailable job finishes the rest; a booking refunded but not
 * moved is finished by the charge.refunded webhook, with the reason saved
 * on it before the refund.
 */
export async function cancelSession(db: SupabaseClient, stripe: Stripe, sessionId: string, reason: string, by: "provider" | "system" = "provider") {
  const { error } = await db.from("experience_sessions").update({ status: "cancelled" }).eq("id", sessionId).eq("status", "scheduled");
  if (error) throw new BookingError(error.message, 409);
  // bounded: one session's bookings, at most its capacity (500)
  const { data, error: listError } = await bookingRecords(db).select("id, status").eq("session_id", sessionId).in("status", ["pending_payment", "confirmed"]);
  if (listError) throw new Error(listError.message);
  const done: string[] = [];
  for (const row of data ?? []) {
    let status = row.status as string;
    // A checkout still open: expire it. One paid at that moment becomes a
    // confirmed booking, which is then refunded like the rest.
    if (status === "pending_payment") {
      const fresh = await read(db, row.id);
      if (fresh.stripe_checkout_session_id) await abandonCheckout(db, stripe, fresh.stripe_checkout_session_id as string);
      status = (await read(db, row.id)).status;
      if (status !== "confirmed") { done.push(`${row.id}: checkout expired`); continue; }
    }
    const b = await read(db, row.id);
    await saveCancelReason(db, b.id, "confirmed", reason);
    const refunded = await refundInFull(stripe, b, { lokl_action: "cancel_session", cancelled_by: by });
    const moved = await move(db, b.id, "confirmed", {
      status: "cancelled", cancelled_by: by, cancel_reason: reason, status_changed_by: by,
      // real time: when it happened (a record).
      refunded_cents: refunded, refunded_at: new Date().toISOString(),
    });
    done.push(`${b.id}: ${moved ? "cancelled, refunded in full" : "already cancelled"}`);
  }
  return done;
}

/** "The provider didn't show up": recorded once, and the payout held at once. */
export async function reportProblem(db: SupabaseClient, bookingId: string, note: string) {
  // real time: when it happened (a record).
  const now = new Date().toISOString();
  const { data, error } = await bookingRecords(db)
    .update({ problem_reported_at: now, problem_note: note, payout_hold: "problem_reported", payout_held_at: now })
    .eq("id", bookingId)
    .is("problem_reported_at", null)
    .is("payout_hold", null)
    .select("id");
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    throw new Error(error.message);
  }
  if ((data ?? []).length) return "reported";
  // Already held for another reason: still record the report (the hold stays).
  const { data: again, error: againError } = await bookingRecords(db)
    .update({ problem_reported_at: now, problem_note: note })
    .eq("id", bookingId)
    .is("problem_reported_at", null)
    .select("id");
  if (againError) {
    if (againError.code === "23514") throw new BookingError(againError.message, 409);
    throw new Error(againError.message);
  }
  if ((again ?? []).length) return "reported";
  throw new BookingError("A problem has already been reported on this booking.", 409);
}
