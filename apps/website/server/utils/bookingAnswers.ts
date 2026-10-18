import { stripeErrorSummary } from "@repo/types";
// A provider answers a Service request (a slot booked in Approve mode):
// accept it (the card hold is captured) or decline (the hold is released)
// (docs/design/booking-and-checkout.md, step 4 part 4;
// docs/design/service-availability.md: the time is the slot, fixed when
// it was booked).
//
// Plain TypeScript with no Nuxt imports, like bookings.ts: the routes call it
// with the server key after checking the provider owns the booking, and
// supabase/tests/app/provider-bookings.test.mts runs the same code against
// the local stack and the Lokl sandbox. The database has the last word on
// every status change (bookings_guard: before the answer-by time, for a time
// still ahead, and never a different time).

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BookingError } from "./bookings";
import { bookingRecords, FINANCES, withFinances } from "./bookingRecords";
import { refundInFull } from "./bookingCancellations";

export interface RequestRow {
  id: string;
  kind: "service" | "experience";
  status: string;
  provider_id: string;
  respond_by: string | null;
  starts_at: string | null;
  total_cents: number;
  stripe_payment_intent_id: string | null;
}

export const CARD_NOT_CHARGED =
  "The customer's card couldn't be charged, so this request has ended. Nothing was charged.";
export const ALREADY_ANSWERED = "This request has already been answered.";
const STRIPE_DOWN = "Stripe didn't respond, so nothing changed. Please try again.";

// Idempotency keys for answers: the booking, the action and a 10-minute
// window, so a double click or a retry acts once, but a later try isn't
// handed a stored error (CLAUDE.md).
const answerKey = (bookingId: string, action: string) =>
  // real time: Stripe's idempotency-key window, on Stripe's clock.
  `booking:${bookingId}:${action}:${Math.floor(Date.now() / 600_000)}`;

async function read(db: SupabaseClient, id: string) {
  const { data, error } = await bookingRecords(db).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as RequestRow & Record<string, unknown>;
}

// Moves a booking only from the status we read. Database rule errors come
// back as BookingErrors with the database's sentence.
async function move(db: SupabaseClient, id: string, from: string, update: Record<string, unknown>) {
  const { data, error } = await bookingRecords(db).update(update).eq("id", id).eq("status", from).select("id");
  if (error) {
    if (error.code === "23514") throw new BookingError(error.message, 409);
    throw new Error(error.message);
  }
  return (data ?? []).length > 0;
}

/** Whether the provider may still accept the request (its booked slot), or why not. */
export function checkAcceptable(b: RequestRow, now = Date.now()): string | null {
  if (b.kind !== "service") return "Only Service requests are accepted. Experience bookings are confirmed when paid.";
  if (b.status !== "requested") return ALREADY_ANSWERED;
  if (b.respond_by && Date.parse(b.respond_by) <= now) return "The time to answer this request has passed.";
  if (!b.starts_at || Date.parse(b.starts_at) <= now) return "That time has already passed.";
  return null;
}

/**
 * Records an accepted request from its captured PaymentIntent, whose
 * metadata says what the capture meant (an accept, and when the provider
 * accepted), so it's the same whether the accept's reply arrived, was lost
 * and retried, or is finished by Stripe's webhook or the expire-requests job
 * (the lost-reply check, 2026-10-11). The booking keeps its slot; it's
 * confirmed as of the time the provider accepted, so a request accepted in
 * time stays accepted after its answer-by time. If the slot has passed, or
 * the booking can't be confirmed, the charge is refunded and the request
 * ends: nobody pays for something that isn't booked.
 * Returns "accepted", "already accepted", or null when the payment isn't an
 * accept lokl made (pass `ours` when the caller knows it is); throws a
 * BookingError after refunding.
 */
export async function finishAccept(
  db: SupabaseClient, stripe: Stripe, b: RequestRow & Record<string, unknown>, intent: Stripe.PaymentIntent,
  ours = false,
): Promise<"accepted" | "already accepted" | null> {
  if (intent.status !== "succeeded") return null;
  const meta = intent.metadata ?? {};
  if (meta.lokl_action !== "accept" && !ours) return null;
  const acceptedAt = meta.lokl_action === "accept" && meta.accepted_at ? meta.accepted_at : null;
  const charge = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id ?? null;
  if (b.status === "confirmed") return "already accepted";

  let refusal: BookingError | null = null;
  // real time: a rule the database checks too (a request can be accepted until it starts).
  if (b.status === "requested" && b.starts_at && Date.parse(b.starts_at) > Date.now()) {
    try {
      const moved = await move(db, b.id, "requested", {
        status: "confirmed", status_changed_by: "provider", stripe_charge_id: charge,
        ...(acceptedAt ? { confirmed_at: acceptedAt } : {}),
      });
      if (moved) return "accepted";
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      refusal = e;
    }
  } else if (b.status === "requested") {
    refusal = new BookingError("That time has already passed, so the customer's card was refunded.", 409);
  }

  const now = await read(db, b.id);
  if (now.status === "confirmed") return "already accepted";
  // Charged, but the booking can't be confirmed: give the money back.
  const refunded = await refundInFull(stripe, now as never);
  if (now.status === "requested") {
    await move(db, b.id, "requested", {
      // real time: when it happened (a record).
      status: "expired", status_changed_by: "system", refunded_cents: refunded, refunded_at: new Date().toISOString(),
    });
  } else if ((now.refunded_cents as number) < refunded) {
    // real time: when it happened (a record).
    await bookingRecords(db).update({ refunded_cents: refunded, refunded_at: new Date().toISOString() }).eq("id", b.id);
  }
  throw refusal ?? new BookingError(ALREADY_ANSWERED, 409);
}

/**
 * Accept: capture the hold, with what it means (an accept, and when the
 * provider accepted), then confirm the booking for its slot (finishAccept).
 * Safe to call twice, and after a lost reply: a hold already captured is
 * finished from Stripe, even after the answer-by time. If the card can't be
 * charged, the request ends (expired, by the system).
 */
export async function acceptRequest(db: SupabaseClient, stripe: Stripe, bookingId: string) {
  const b = await read(db, bookingId);
  if (b.kind === "service" && b.status === "confirmed") return "already accepted";
  if (b.kind === "service" && b.status === "requested" && b.stripe_payment_intent_id) {
    // Captured already (the reply to an earlier accept was lost): finish that one.
    const intent = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id).catch(() => {
      throw new BookingError(STRIPE_DOWN, 502);
    });
    if (intent.status === "succeeded") {
      const done = await finishAccept(db, stripe, b, intent, true);
      if (done) return done;
      throw new BookingError(ALREADY_ANSWERED, 409);
    }
  }
  const problem = checkAcceptable(b);
  if (problem) throw new BookingError(problem, 409);
  if (!b.stripe_payment_intent_id) throw new Error(`booking ${b.id} is requested with no PaymentIntent`);

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.capture(
      b.stripe_payment_intent_id,
      // real time: when it happened (a record).
      { metadata: { booking_id: b.id, lokl_action: "accept", accepted_at: new Date().toISOString() } },
      { idempotencyKey: answerKey(b.id, "capture") },
    );
  } catch (error) {
    // Go by what Stripe has now: captured already (a retry), the hold gone,
    // or Stripe not answering (nothing changes, try again).
    intent = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id).catch(() => {
      throw new BookingError(STRIPE_DOWN, 502);
    });
    if (intent.status !== "succeeded") {
      if (intent.status === "requires_capture") {
        console.error("[bookings] capture failed", b.id, stripeErrorSummary(error));
        throw new BookingError(STRIPE_DOWN, 502);
      }
      // Marked as the provider's doing (they tried to accept), so the
      // customer's email says the card failed, not that nobody answered.
      await move(db, b.id, "requested", { status: "expired", status_changed_by: "provider" });
      throw new BookingError(CARD_NOT_CHARGED, 409);
    }
  }
  const done = await finishAccept(db, stripe, b, intent, true);
  if (!done) throw new Error(`booking ${b.id}: the capture couldn't be recorded`);
  return done;
}

/**
 * Decline: mark what releasing the hold means (a decline, so Stripe's
 * webhook records it as one if the reply is lost), release the hold, then
 * mark the request declined. Safe to call twice.
 */
export async function declineRequest(db: SupabaseClient, stripe: Stripe, bookingId: string) {
  const b = await read(db, bookingId);
  if (b.status === "declined") return "already declined";
  if (b.kind !== "service" || b.status !== "requested") throw new BookingError(ALREADY_ANSWERED, 409);
  if (!b.stripe_payment_intent_id) throw new Error(`booking ${b.id} is requested with no PaymentIntent`);

  try {
    await stripe.paymentIntents.update(b.stripe_payment_intent_id, { metadata: { lokl_release: "decline" } });
    await stripe.paymentIntents.cancel(b.stripe_payment_intent_id, {}, { idempotencyKey: answerKey(b.id, "release") });
  } catch {
    const intent = await stripe.paymentIntents.retrieve(b.stripe_payment_intent_id).catch(() => {
      throw new BookingError(STRIPE_DOWN, 502);
    });
    if (intent.status !== "canceled") throw new BookingError(STRIPE_DOWN, 502);
  }
  if (await move(db, b.id, "requested", { status: "declined", status_changed_by: "provider" })) return "declined";
  const now = await read(db, b.id);
  if (now.status === "declined") return "already declined";
  throw new BookingError(ALREADY_ANSWERED, 409);
}
