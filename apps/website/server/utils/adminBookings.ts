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
import { type CancelMeaning, recordAdminCancel, refundInFull, releaseHold, reverseTransfer, saveCancelReason } from "./bookingCancellations";
import { payOut, withdrawUnavailable } from "./bookingJobs";
import { bookingRecords, FINANCES, withFinances } from "./bookingRecords";

export type AdminAction =
  | "cancel_booking" | "release_payout" | "resolve_problem_paid" | "resolve_problem_refunded"
  | "retry_email" | "suspend_provider" | "reinstate_provider";

// real time: Stripe's idempotency-key window, on Stripe's clock.
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

/**
 * A refusal from an action's database function, as a plain answer: support
 * asking for what needs the owner (403), or a request no longer waiting (409).
 */
function actionError(error: { code?: string; message: string }) {
  if (error.code === "42501") return new BookingError(error.message, 403);
  if (error.code === "23514") return new BookingError(error.message, 409);
  return new Error(error.message);
}

async function read(db: SupabaseClient, id: string) {
  const { data, error } = await bookingRecords(db).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new BookingError("We couldn't find that booking.", 404);
  return data as Record<string, any>;
}

/**
 * lokl cancels a booking, with a reason: a request's hold is released; a
 * confirmed, completed or paid-out booking is refunded in full, and after a
 * payout the provider's transfer is reversed (a failed reversal is recorded
 * as owed). With resolveProblem, it's the refund outcome of a no-show report.
 * Stripe first, with what the step means (CancelMeaning) and the reason
 * saved on the booking, so a lost reply is finished by a retry or by
 * Stripe's webhook; then the booking and the admin log together
 * (admin_cancel_booking). A retry of a finished cancel answers that it's
 * done, and writes the log if it's missing.
 */
export async function adminCancelBooking(
  db: SupabaseClient, stripe: Stripe, bookingId: string, adminId: string, reasonIn: string,
  opts: { resolveProblem?: boolean; requestId?: string | null } = {},
) {
  const reason = requireReason(reasonIn);
  const b = await read(db, bookingId);
  const resolveProblem = !!opts.resolveProblem;
  const requestId = opts.requestId ?? null;
  const outcome = (done: Awaited<ReturnType<typeof recordAdminCancel>>, owed = false) =>
    done === "changed" ? "already changed"
    : done !== "cancelled" ? "already cancelled"
    : owed ? "cancelled and refunded; the provider's share is owed (the reversal failed)" : "cancelled and refunded";
  if (b.status === "cancelled" && b.cancelled_by === "admin") {
    return outcome(await recordAdminCancel(db, { bookingId: b.id, adminId, reason, from: "cancelled", resolveProblem, refundedCents: null, requestId }));
  }
  if (resolveProblem && (!b.problem_reported_at || b.problem_resolution)) {
    throw new BookingError("There's no open report on this booking.", 409);
  }
  const meaning: CancelMeaning = {
    lokl_action: "cancel", cancelled_by: "admin", admin_id: adminId,
    ...(resolveProblem ? { resolve_problem: "true" as const } : {}),
    ...(requestId ? { admin_request_id: requestId } : {}),
  };

  if (b.status === "requested") {
    await saveCancelReason(db, b.id, "requested", reason);
    await releaseHold(stripe, b as any, { lokl_release: "cancel", cancelled_by: "admin", admin_id: adminId });
    return outcome(await recordAdminCancel(db, { bookingId: b.id, adminId, reason, from: "requested", resolveProblem, refundedCents: null, requestId }));
  }
  if (!["confirmed", "completed", "paid_out"].includes(b.status)) {
    throw new BookingError(
      b.status === "pending_payment" ? "This booking is still in checkout; it will lapse on its own." : `A ${b.status} booking can't be cancelled.`,
      409,
    );
  }
  // The refund limit for support, on what's left of the charge, before
  // Stripe (admin_check_refund; the record checks again).
  const { error: limitError } = await db.rpc("admin_check_refund", { p_admin_id: adminId, p_booking_id: b.id });
  if (limitError) {
    if (limitError.code === "42501") throw new BookingError(limitError.message, 403);
    throw new Error(limitError.message);
  }
  await saveCancelReason(db, b.id, b.status, reason);
  const refunded = await refundInFull(stripe, b as any, meaning);
  const reversal = b.status === "paid_out" ? await reverseTransfer(stripe, b) : null;
  const done = await recordAdminCancel(db, {
    bookingId: b.id, adminId, reason, from: b.status, resolveProblem, refundedCents: refunded,
    reversalId: reversal && "id" in reversal ? reversal.id : null,
    reversalFailure: reversal && "failure" in reversal ? reversal.failure : null,
    requestId,
  });
  return outcome(done, !!reversal && "failure" in reversal);
}

/**
 * Clears a payout hold, with a reason, and pays out straight away if it's
 * due. A reported no-show is resolved with resolveProblemPaid instead; an
 * open dispute can't be released. The release is remembered
 * (payout_holds_released), so the pay-out job doesn't hold the payout again
 * for the same judgement (a lost dispute, a refund, a suspension). The
 * release and its admin log are written together (admin_release_payout).
 */
export async function releasePayout(
  db: SupabaseClient, stripe: Stripe, bookingId: string, adminId: string, reasonIn: string, opts: { requestId?: string | null } = {},
) {
  const reason = requireReason(reasonIn);
  const b = await read(db, bookingId);
  if (!b.payout_hold && !opts.requestId) return "nothing held";
  if (b.payout_hold === "problem_reported") throw new BookingError("A customer reported a problem: resolve the report instead.", 409);
  if (b.disputed_at && !b.dispute_closed_at) throw new BookingError("The dispute is still open, so the payout stays held.", 409);
  const { data: released, error } = await db.rpc("admin_release_payout", {
    p_booking_id: b.id, p_admin_id: adminId, p_reason: reason, p_hold: b.payout_hold ?? "", p_request_id: opts.requestId ?? null,
  });
  if (error) throw actionError(error);
  if (!released) return "nothing held";
  const run = await payOut(db, stripe, { bookingId: b.id });
  return run.done.at(-1)?.split(": ").slice(1).join(": ") || "released; it's paid out when due";
}

/**
 * Resolves a no-show report in the provider's favour: the payout goes ahead
 * (now, if it's due). The resolution and its admin log are written together
 * (admin_resolve_problem_paid).
 */
export async function resolveProblemPaid(
  db: SupabaseClient, stripe: Stripe, bookingId: string, adminId: string, reasonIn: string, opts: { requestId?: string | null } = {},
) {
  const reason = requireReason(reasonIn);
  const b = await read(db, bookingId);
  if (!opts.requestId) {
    if (b.problem_resolution === "paid_provider") return "already resolved";
    if (!b.problem_reported_at || b.problem_resolution) throw new BookingError("There's no open report on this booking.", 409);
  }
  const { data, error } = await db.rpc("admin_resolve_problem_paid", {
    p_booking_id: b.id, p_admin_id: adminId, p_reason: reason, p_request_id: opts.requestId ?? null,
  });
  if (error) throw actionError(error);
  if (!data) return "already resolved";
  await payOut(db, stripe, { bookingId: b.id });
  return "resolved: the provider will be paid";
}

/** Puts a failed or skipped email back in the queue (the caller then sends it). */
export async function retryEmail(db: SupabaseClient, emailId: string, adminId: string) {
  const { data, error } = await db
    .from("booking_emails")
    // real time: due straight away.
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
  messageIn?: string | null, opts: { requestId?: string | null } = {},
) {
  const reason = requireReason(reasonIn);
  const message = (messageIn ?? "").trim().slice(0, 1000) || null;
  // One transaction (admin_set_provider_status): the status, the logged
  // action with the internal reason, and the provider's email with lokl's
  // optional message. The reason never goes in the email.
  const { data: changed, error } = await db.rpc("admin_set_provider_status", {
    p_provider_id: providerId, p_status: status, p_admin_id: adminId, p_reason: reason, p_message: message,
    p_request_id: opts.requestId ?? null,
  });
  if (error) {
    if (error.code === "P0002") throw new BookingError("We couldn't find that provider.", 404);
    if (error.code === "23514") throw new BookingError(error.message, 400);
    throw actionError(error);
  }
  if (!changed) return status === "suspended" ? "already suspended" : "already active";
  if (status === "suspended") {
    const w = await withdrawUnavailable(db, stripe);
    return `suspended; ${w.done.length} open ${w.done.length === 1 ? "request or checkout was" : "requests or checkouts were"} withdrawn`;
  }
  return "reinstated";
}
