// What the admin does to bookings, emails and providers (docs/design/
// booking-and-checkout.md, Admin; step 4 part 8). Every action needs a
// reason (except sending an email again) and is logged in admin_actions;
// status changes are also in booking_events with "admin" as the actor.
// Refunds are always in full (decided 2026-10-03; partial refunds are a
// later idea), and when lokl cancels, the provider isn't paid.
//
// Plain TypeScript with no Nuxt imports, like bookings.ts: the website's
// /api/admin/* routes call it after requireAdminRequest, and
// supabase/tests/app/admin-actions.test.mts runs it against the local stack
// and the Lokl sandbox.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BookingError } from "./bookings";
import { refundInFull } from "./bookingCancellations";
import { payOut, withdrawUnavailable } from "./bookingJobs";
import { bookingRecords, FINANCES, withFinances } from "./bookingRecords";

export type AdminAction =
  | "cancel_booking" | "release_payout" | "resolve_problem_paid" | "resolve_problem_refunded"
  | "retry_email" | "suspend_provider" | "reinstate_provider";

const key = (id: string, action: string) => `admin:${id}:${action}:${Math.floor(Date.now() / 600_000)}`;

export function requireReason(reason: string | undefined): string {
  const r = (reason ?? "").trim();
  if (r.length < 5) throw new BookingError("Say why, in a few words. It's kept with the booking's history.", 400);
  return r.slice(0, 1000);
}

export async function logAdminAction(
  db: SupabaseClient,
  a: { adminId: string; target: "booking" | "provider" | "email"; targetId: string; action: AdminAction; reason?: string | null },
) {
  const { error } = await db.from("admin_actions").insert({
    admin_id: a.adminId, target: a.target, target_id: a.targetId, action: a.action, reason: a.reason ?? null,
  });
  if (error) throw new Error(`couldn't log the admin action: ${error.message}`);
}

async function read(db: SupabaseClient, id: string) {
  const { data, error } = await bookingRecords(db).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new BookingError("We couldn't find that booking.", 404);
  return data as Record<string, any>;
}

async function move(db: SupabaseClient, id: string, from: string, update: Record<string, unknown>) {
  const { data, error } = await bookingRecords(db).update(update).eq("id", id).eq("status", from).select("id");
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    throw new Error(error.message);
  }
  return (data ?? []).length > 0;
}

// Takes the provider's share back after a payout. Reads the transfer first,
// so a retry reverses nothing more. A failure (usually an empty balance) is
// returned, to be recorded as money owed, not thrown.
async function reverseTransfer(stripe: Stripe, b: Record<string, any>): Promise<{ id: string } | { failure: string }> {
  const transfer = await stripe.transfers.retrieve(b.stripe_transfer_id);
  const left = transfer.amount - transfer.amount_reversed;
  if (left <= 0) {
    const existing = (await stripe.transfers.listReversals(transfer.id, { limit: 1 })).data[0];
    return { id: existing?.id ?? `${transfer.id}:reversed` };
  }
  try {
    const reversal = await stripe.transfers.createReversal(
      transfer.id,
      { amount: left, metadata: { booking_id: b.id } },
      { idempotencyKey: key(b.id, "reverse") },
    );
    return { id: reversal.id };
  } catch (e) {
    const err = e as Stripe.errors.StripeError;
    if (err.type === "StripeInvalidRequestError" || err.type === "StripePermissionError") return { failure: err.message.slice(0, 500) };
    throw e;
  }
}

/**
 * lokl cancels a booking, with a reason: a request's hold is released; a
 * confirmed, completed or paid-out booking is refunded in full, and after a
 * payout the provider's transfer is reversed (a failed reversal is recorded
 * as owed). With resolveProblem, it's the refund outcome of a no-show report.
 */
export async function adminCancelBooking(
  db: SupabaseClient, stripe: Stripe, bookingId: string, adminId: string, reasonIn: string,
  opts: { resolveProblem?: boolean } = {},
) {
  const reason = requireReason(reasonIn);
  const b = await read(db, bookingId);
  const action: AdminAction = opts.resolveProblem ? "resolve_problem_refunded" : "cancel_booking";
  if (b.status === "cancelled" && b.cancelled_by === "admin") return "already cancelled";
  if (opts.resolveProblem && (!b.problem_reported_at || b.problem_resolution)) {
    throw new BookingError("There's no open report on this booking.", 409);
  }

  let update: Record<string, unknown> = { status: "cancelled", cancelled_by: "admin", cancel_reason: reason, status_changed_by: "admin" };
  if (b.status === "requested") {
    if (b.stripe_payment_intent_id) {
      try {
        await stripe.paymentIntents.cancel(b.stripe_payment_intent_id, {}, { idempotencyKey: key(b.id, "release") });
      } catch (e) {
        if ((await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id)).status !== "canceled") throw e;
      }
    }
  } else if (["confirmed", "completed", "paid_out"].includes(b.status)) {
    const refunded = await refundInFull(stripe, b as any);
    update = { ...update, refunded_cents: refunded, refunded_at: new Date().toISOString() };
    if (b.status === "paid_out") {
      const r = await reverseTransfer(stripe, b);
      update = "id" in r
        ? { ...update, stripe_transfer_reversal_id: r.id }
        : { ...update, reversal_failed_at: new Date().toISOString(), reversal_failure: r.failure };
    }
  } else {
    throw new BookingError(
      b.status === "pending_payment" ? "This booking is still in checkout; it will lapse on its own." : `A ${b.status} booking can't be cancelled.`,
      409,
    );
  }
  if (opts.resolveProblem) update = { ...update, problem_resolution: "refunded", problem_resolved_at: new Date().toISOString() };

  if (!(await move(db, b.id, b.status, update))) return "already changed";
  await logAdminAction(db, { adminId, target: "booking", targetId: b.id, action, reason });
  return update.reversal_failed_at ? "cancelled and refunded; the provider's share is owed (the reversal failed)" : "cancelled and refunded";
}

/**
 * Clears a payout hold, with a reason, and pays out straight away if it's
 * due. A reported no-show is resolved with resolveProblemPaid instead; an
 * open dispute can't be released.
 */
export async function releasePayout(db: SupabaseClient, stripe: Stripe, bookingId: string, adminId: string, reasonIn: string) {
  const reason = requireReason(reasonIn);
  const b = await read(db, bookingId);
  if (!b.payout_hold) return "nothing held";
  if (b.payout_hold === "problem_reported") throw new BookingError("A customer reported a problem: resolve the report instead.", 409);
  if (b.disputed_at && !b.dispute_closed_at) throw new BookingError("The dispute is still open, so the payout stays held.", 409);
  const { error } = await bookingRecords(db).update({ payout_hold: null, payout_held_at: null }).eq("id", b.id).eq("payout_hold", b.payout_hold);
  if (error) throw new Error(error.message);
  await logAdminAction(db, { adminId, target: "booking", targetId: b.id, action: "release_payout", reason });
  const run = await payOut(db, stripe, { bookingId: b.id });
  return run.done.at(-1)?.split(": ").slice(1).join(": ") || "released; it's paid out when due";
}

/** Resolves a no-show report in the provider's favour: the payout goes ahead (now, if it's due). */
export async function resolveProblemPaid(db: SupabaseClient, stripe: Stripe, bookingId: string, adminId: string, reasonIn: string) {
  const reason = requireReason(reasonIn);
  const b = await read(db, bookingId);
  if (!b.problem_reported_at || b.problem_resolution) throw new BookingError("There's no open report on this booking.", 409);
  const update: Record<string, unknown> = { problem_resolution: "paid_provider", problem_resolved_at: new Date().toISOString() };
  if (b.payout_hold === "problem_reported") Object.assign(update, { payout_hold: null, payout_held_at: null });
  const { data, error } = await bookingRecords(db).update(update).eq("id", b.id).is("problem_resolution", null).select("id");
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    throw new Error(error.message);
  }
  if (!data?.length) return "already resolved";
  await logAdminAction(db, { adminId, target: "booking", targetId: b.id, action: "resolve_problem_paid", reason });
  await payOut(db, stripe, { bookingId: b.id });
  return "resolved: the provider will be paid";
}

/** Puts a failed or skipped email back in the queue (the caller then sends it). */
export async function retryEmail(db: SupabaseClient, emailId: string, adminId: string) {
  const { data, error } = await db
    .from("booking_emails")
    .update({ status: "pending", attempts: 0, last_error: null, skip_reason: null, next_attempt_at: new Date().toISOString(), locked_at: null })
    .eq("id", emailId)
    .in("status", ["failed", "skipped"])
    .select("booking_id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new BookingError("Only a failed or skipped email can be sent again.", 409);
  await logAdminAction(db, { adminId, target: "email", targetId: emailId, action: "retry_email" });
  return data[0]!.booking_id as string;
}

/**
 * Suspends or reinstates a provider, with a reason. Suspending hides their
 * listings at once (the public rules check the provider), withdraws their
 * open requests and checkouts, and holds their payouts (the jobs' rules).
 */
export async function setProviderStatus(
  db: SupabaseClient, stripe: Stripe, providerId: string, status: "active" | "suspended", adminId: string, reasonIn: string,
  messageIn?: string | null,
) {
  const reason = requireReason(reasonIn);
  const message = (messageIn ?? "").trim().slice(0, 1000) || null;
  // One transaction (admin_set_provider_status): the status, the logged
  // action with the internal reason, and the provider's email with lokl's
  // optional message. The reason never goes in the email.
  const { data: changed, error } = await db.rpc("admin_set_provider_status", {
    p_provider_id: providerId, p_status: status, p_admin_id: adminId, p_reason: reason, p_message: message,
  });
  if (error) {
    if (error.code === "P0002") throw new BookingError("We couldn't find that provider.", 404);
    if (error.code === "23514") throw new BookingError(error.message, 400);
    throw new Error(error.message);
  }
  if (!changed) return status === "suspended" ? "already suspended" : "already active";
  if (status === "suspended") {
    const w = await withdrawUnavailable(db, stripe);
    return `suspended; ${w.done.length} open ${w.done.length === 1 ? "request or checkout was" : "requests or checkouts were"} withdrawn`;
  }
  return "reinstated";
}
