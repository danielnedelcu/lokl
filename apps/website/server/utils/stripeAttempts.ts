import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Idempotency keys for every money-moving Stripe call (a transfer, refund,
// reversal or capture; decided 2026-10-21): fixed per booking, action and
// attempt, never per time window. Two calls at once (two job runs, a double
// click) send the same key, so Stripe acts once. The attempt goes up only
// after Stripe definitely refuses it (private.stripe_refused), because
// Stripe keeps a key's answer for 24 hours: a later try after the cause is
// fixed (an account set up, a dispute closed) gets a fresh key, not the
// stored refusal. A timeout or Stripe being down keeps the same key, so a
// call that went through but whose answer was lost comes back as itself.

export type MoneyAction = "transfer" | "refund" | "reversal" | "capture";

/** The current attempt for a booking's money-moving action (1 the first time). */
export async function stripeAttempt(db: SupabaseClient, bookingId: string, action: MoneyAction): Promise<number> {
  const { data, error } = await db.schema("private").rpc("stripe_attempt", { p_booking_id: bookingId, p_action: action });
  if (error) throw new Error(`stripe_attempt: ${error.message}`);
  return data as number;
}

/** After Stripe definitely refused `attempt`: the next try uses a new key (raised once, however many calls saw it). */
export async function stripeRefused(db: SupabaseClient, bookingId: string, action: MoneyAction, attempt: number): Promise<void> {
  const { error } = await db.schema("private").rpc("stripe_refused", { p_booking_id: bookingId, p_action: action, p_attempt: attempt });
  if (error) throw new Error(`stripe_refused: ${error.message}`);
}

/** booking:<id>:<action>[:<detail>]:<attempt>. A refund's detail is its amount, as a booking may be refunded more than once. */
export function moneyKey(bookingId: string, action: MoneyAction, attempt: number, detail?: string | number): string {
  return `booking:${bookingId}:${action}:${detail === undefined ? "" : `${detail}:`}${attempt}`;
}

/** Whether Stripe answered and said no (as opposed to a timeout or an outage, which keep the same key). */
export function definiteRefusal(e: unknown): boolean {
  const type = (e as Stripe.errors.StripeError | null)?.type;
  return type === "StripeInvalidRequestError" || type === "StripePermissionError" || type === "StripeCardError";
}
