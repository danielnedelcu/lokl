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
// booking is moved, only from the status read; a retry refunds once.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customerCancelOutcome } from "@repo/types";
import { abandonCheckout, BookingError } from "./bookings";

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

const key = (bookingId: string, action: string) => `booking:${bookingId}:${action}:${Math.floor(Date.now() / 600_000)}`;

async function read(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("bookings").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as CancelRow & Record<string, unknown>;
}

async function move(db: SupabaseClient, id: string, from: string, update: Record<string, unknown>) {
  const { data, error } = await db.from("bookings").update(update).eq("id", id).eq("status", from).select("id");
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    throw new Error(error.message);
  }
  return (data ?? []).length > 0;
}

/**
 * Refunds whatever of the booking's charge isn't refunded yet. Reads the
 * charge first, so a second call (a retry, a double click) refunds nothing.
 * Returns the total now refunded, in cents.
 */
export async function refundInFull(stripe: Stripe, b: CancelRow): Promise<number> {
  if (!b.stripe_payment_intent_id) throw new Error(`booking ${b.id} has no payment`);
  const pi = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id, { expand: ["latest_charge"] });
  const charge = pi.latest_charge as Stripe.Charge | null;
  if (!charge || pi.status !== "succeeded") throw new Error(`booking ${b.id}'s payment is ${pi.status}`);
  const left = Math.min(b.total_cents, charge.amount) - charge.amount_refunded;
  if (left > 0) {
    await stripe.refunds.create(
      { payment_intent: pi.id, amount: left, reason: "requested_by_customer", metadata: { booking_id: b.id } },
      { idempotencyKey: key(b.id, `refund-${left}`) },
    );
  }
  return Math.min(b.total_cents, charge.amount);
}

async function releaseHold(stripe: Stripe, b: CancelRow) {
  if (!b.stripe_payment_intent_id) return;
  try {
    await stripe.paymentIntents.cancel(b.stripe_payment_intent_id, {}, { idempotencyKey: key(b.id, "release") });
  } catch (e) {
    const pi = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id);
    if (pi.status !== "canceled") throw e;
  }
}

/** The customer cancels: free for a request, then by the policy. */
export async function customerCancel(db: SupabaseClient, stripe: Stripe, bookingId: string) {
  const b = await read(db, bookingId);
  if (b.status === "cancelled" && b.cancelled_by === "customer") return "already cancelled";
  const outcome = customerCancelOutcome(b);
  switch (outcome.kind) {
    case "not_allowed":
      throw new BookingError(outcome.why, 409);
    case "release":
      await releaseHold(stripe, b);
      return (await move(db, b.id, "requested", { status: "cancelled", cancelled_by: "customer", status_changed_by: "customer" }))
        ? "cancelled, hold released" : "already cancelled";
    case "full_refund": {
      const refunded = await refundInFull(stripe, b);
      return (await move(db, b.id, "confirmed", {
        status: "cancelled", cancelled_by: "customer", status_changed_by: "customer",
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
  if (b.status !== "confirmed") throw new BookingError("Only a confirmed booking can be cancelled. Decline a request instead.", 409);
  if (b.starts_at && Date.now() >= Date.parse(b.starts_at)) throw new BookingError("This booking has started, so it can't be cancelled.", 409);
  const refunded = await refundInFull(stripe, b);
  return (await move(db, b.id, "confirmed", {
    status: "cancelled", cancelled_by: "provider", cancel_reason: reason, status_changed_by: "provider",
    refunded_cents: refunded, refunded_at: new Date().toISOString(),
  })) ? "cancelled, refunded in full" : "already cancelled";
}

/**
 * The provider cancels a whole session: the session first (so nobody can
 * book it meanwhile), then every booking on it, refunded in full. Safe to
 * run again: what's done stays done. If Stripe fails partway, the
 * withdraw-unavailable job finishes the rest.
 */
export async function cancelSession(db: SupabaseClient, stripe: Stripe, sessionId: string, reason: string, by: "provider" | "system" = "provider") {
  const { error } = await db.from("experience_sessions").update({ status: "cancelled" }).eq("id", sessionId).eq("status", "scheduled");
  if (error) throw new BookingError(error.message, 409);
  const { data, error: listError } = await db.from("bookings").select("id, status").eq("session_id", sessionId).in("status", ["pending_payment", "confirmed"]);
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
    const refunded = await refundInFull(stripe, b);
    const moved = await move(db, b.id, "confirmed", {
      status: "cancelled", cancelled_by: by, cancel_reason: reason, status_changed_by: by,
      refunded_cents: refunded, refunded_at: new Date().toISOString(),
    });
    done.push(`${b.id}: ${moved ? "cancelled, refunded in full" : "already cancelled"}`);
  }
  return done;
}

/** "The provider didn't show up": recorded once, and the payout held at once. */
export async function reportProblem(db: SupabaseClient, bookingId: string, note: string) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("bookings")
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
  const { data: again, error: againError } = await db
    .from("bookings")
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
