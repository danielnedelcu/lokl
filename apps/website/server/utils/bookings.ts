// Checkout and payments webhook logic for bookings
// (docs/design/booking-and-checkout.md, step 4 part 2).
//
// Plain TypeScript with no Nuxt imports: the routes call it with the server
// key and Stripe, and the booking checkout test
// (supabase/tests/app/booking-checkout.test.mts) runs the same code against
// the local stack and the Lokl sandbox. The database prices bookings and
// guards their statuses (create_service_request, reserve_experience_booking,
// bookings_guard); this module only adds Stripe.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperienceBookingRequest, ServiceBookingRequest } from "@repo/types";

/** Checkout's shortest allowed expiry, and how long spots or a request are held. */
export const CHECKOUT_WINDOW_MS = 30 * 60 * 1000 + 60 * 1000; // 31 minutes, safely over Stripe's 30
export const RESPOND_WITHIN_MS = 48 * 60 * 60 * 1000;

export class BookingError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

interface BookingRow {
  id: string;
  kind: "service" | "experience";
  status: string;
  listing_id: string;
  total_cents: number;
  unit_price_cents: number;
  party_size: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
}

export interface CheckoutContext {
  db: SupabaseClient; // the server key
  stripe: Stripe;
  siteUrl: string;
  customer: { id: string; email: string };
}

// Idempotency keys: the booking, the action and an attempt number, never a
// fixed key per record (CLAUDE.md: Stripe replays a stored error for 24 hours).
export const idempotencyKey = (bookingId: string, action: string, attempt = 1) => `booking:${bookingId}:${action}:${attempt}`;

// The database raises plain sentences for every rule (spots, notice, own
// listing...); pass those on, and hide anything else.
function fromDatabase(error: { message: string; code?: string }): BookingError {
  if (error.code === "23514" || error.code === "P0001") return new BookingError(error.message, 409);
  console.error("[bookings] database", error);
  return new BookingError("Something went wrong on our side. Please try again.", 500);
}

async function createCheckout(ctx: CheckoutContext, booking: BookingRow, title: string, listingPath: string) {
  const expiresAt = Math.floor((Date.now() + CHECKOUT_WINDOW_MS) / 1000);
  let session: Stripe.Checkout.Session;
  try {
    session = await ctx.stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: ctx.customer.email,
        client_reference_id: booking.id,
        metadata: { booking_id: booking.id },
        line_items: [{
          quantity: booking.party_size,
          price_data: { currency: "usd", unit_amount: booking.unit_price_cents, product_data: { name: title } },
        }],
        payment_intent_data: {
          metadata: { booking_id: booking.id },
          description: `lokl booking ${booking.id}`,
          // Services: hold the card until the provider accepts (decision 2).
          ...(booking.kind === "service" ? { capture_method: "manual" as const } : {}),
        },
        expires_at: expiresAt,
        success_url: `${ctx.siteUrl}/account/bookings/${booking.id}?checkout=done`,
        cancel_url: `${ctx.siteUrl}${listingPath}?checkout=cancelled`,
      },
      { idempotencyKey: idempotencyKey(booking.id, "checkout") },
    );
  } catch (e) {
    // Don't leave spots or a request held for a checkout that doesn't exist.
    await ctx.db.from("bookings")
      .update({ status: "cancelled", cancelled_by: "system", cancel_reason: "Checkout couldn't be started.", status_changed_by: "system" })
      .eq("id", booking.id).eq("status", "pending_payment");
    console.error("[bookings] checkout", e);
    throw new BookingError("Checkout couldn't be started. Please try again.", 502);
  }
  const { error } = await ctx.db.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", booking.id);
  if (error) throw fromDatabase(error);
  return { bookingId: booking.id, url: session.url! };
}

/** A Service request: saved as pending payment, then a Checkout Session that holds the card. */
export async function startServiceCheckout(ctx: CheckoutContext, input: ServiceBookingRequest) {
  const { data: listing } = await ctx.db.from("listings").select("slug, title").eq("id", input.listingId).maybeSingle();
  if (!listing) throw new BookingError("This Service isn't available to book.", 404);
  const { data, error } = await ctx.db.rpc("create_service_request", {
    p_listing_id: input.listingId,
    p_customer_id: ctx.customer.id,
    p_preferred_times: input.preferredTimes,
    p_customer_name: input.name,
    p_customer_email: ctx.customer.email,
    p_customer_phone: input.phone ?? null,
    p_customer_notes: input.notes ?? null,
    p_address: input.address ?? null,
    p_reserved_until: new Date(Date.now() + CHECKOUT_WINDOW_MS).toISOString(),
  });
  if (error) throw fromDatabase(error);
  return createCheckout(ctx, data as BookingRow, listing.title, `/services/${listing.slug}`);
}

/** An Experience booking: spots reserved for the checkout window, then a Checkout Session that charges at once. */
export async function startExperienceCheckout(ctx: CheckoutContext, input: ExperienceBookingRequest) {
  const { data: session } = await ctx.db
    .from("experience_sessions").select("listing:listings(slug, title)").eq("id", input.sessionId).maybeSingle();
  const listing = (session as { listing: { slug: string; title: string } | null } | null)?.listing;
  if (!listing) throw new BookingError("That date isn't available any more.", 404);
  const { data, error } = await ctx.db.rpc("reserve_experience_booking", {
    p_session_id: input.sessionId,
    p_customer_id: ctx.customer.id,
    p_party_size: input.partySize,
    p_customer_name: input.name,
    p_customer_email: ctx.customer.email,
    p_customer_phone: input.phone ?? null,
    p_customer_notes: input.notes ?? null,
    p_reserved_until: new Date(Date.now() + CHECKOUT_WINDOW_MS).toISOString(),
  });
  if (error) throw fromDatabase(error);
  return createCheckout(ctx, data as BookingRow, listing.title, `/experiences/${listing.slug}`);
}

// ---------------------------------------------------------------------------
// Payments webhook
// ---------------------------------------------------------------------------

/** Verifies a payments webhook on its raw body; throws on a bad signature. */
export function verifyPaymentsEvent(stripe: Stripe, payload: string, signature: string, secret: string): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

async function bookingBy(db: SupabaseClient, column: "stripe_checkout_session_id" | "stripe_payment_intent_id", value: string) {
  const { data, error } = await db.from("bookings").select("*").eq(column, value).maybeSingle();
  if (error) throw new Error(error.message);
  return data as (BookingRow & Record<string, unknown>) | null;
}

// Moves a booking only if it's still in the status we read, so a duplicate or
// a slower parallel delivery changes nothing.
async function move(db: SupabaseClient, booking: BookingRow, update: Record<string, unknown>) {
  const { data, error } = await db.from("bookings").update(update).eq("id", booking.id).eq("status", booking.status).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Handles one payments event. Webhooks can arrive late, twice or out of order,
 * so it acts on what Stripe says now (the Checkout Session or PaymentIntent is
 * re-read), and on the booking's current status, never on the event body
 * alone. Returns what it did, for logs and tests.
 */
export async function handlePaymentsEvent(db: SupabaseClient, stripe: Stripe, event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.expired":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id, {
        expand: ["payment_intent"],
      });
      const booking = await bookingBy(db, "stripe_checkout_session_id", session.id);
      if (!booking) return "ignored: no booking for this Checkout Session";
      const pi = session.payment_intent as Stripe.PaymentIntent | null;

      if (session.status === "expired") {
        if (booking.status !== "pending_payment") return `ignored: expired, but the booking is ${booking.status}`;
        return (await move(db, booking, { status: "expired", status_changed_by: "stripe" })) ? "expired" : "ignored: changed meanwhile";
      }
      if (session.status !== "complete" || !pi) return "ignored: checkout not complete";

      if (booking.status !== "pending_payment") {
        // Paid after we'd already let the booking go (shouldn't happen: Checkout
        // expires with the reservation). Give the money back.
        if (["expired", "cancelled"].includes(booking.status) && pi.status === "succeeded" && !booking["refunded_at"]) {
          await stripe.refunds.create({ payment_intent: pi.id }, { idempotencyKey: idempotencyKey(booking.id, "late-refund") });
          await db.from("bookings").update({ stripe_payment_intent_id: pi.id, refunded_cents: booking.total_cents, refunded_at: new Date().toISOString() }).eq("id", booking.id);
          return "refunded: paid after the booking had lapsed";
        }
        return `ignored: already ${booking.status}`;
      }

      if (booking.kind === "service") {
        if (pi.status !== "requires_capture") return `ignored: payment is ${pi.status}`;
        const ok = await move(db, booking, {
          status: "requested",
          status_changed_by: "stripe",
          stripe_payment_intent_id: pi.id,
          respond_by: new Date(Date.now() + RESPOND_WITHIN_MS).toISOString(),
        });
        return ok ? "requested" : "ignored: changed meanwhile";
      }
      if (session.payment_status !== "paid") return `ignored: payment is ${session.payment_status}`;
      const ok = await move(db, booking, {
        status: "confirmed",
        status_changed_by: "stripe",
        stripe_payment_intent_id: pi.id,
        stripe_charge_id: typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null,
      });
      return ok ? "confirmed" : "ignored: changed meanwhile";
    }

    case "payment_intent.canceled": {
      const pi = await stripe.paymentIntents.retrieve((event.data.object as Stripe.PaymentIntent).id);
      const booking = await bookingBy(db, "stripe_payment_intent_id", pi.id);
      if (!booking) return "ignored: no booking for this payment";
      if (pi.status !== "canceled") return `ignored: payment is ${pi.status}`;
      if (booking.status !== "requested") return `ignored: the booking is ${booking.status}`;
      return (await move(db, booking, { status: "expired", status_changed_by: "stripe" })) ? "expired: hold released" : "ignored: changed meanwhile";
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const fresh = await stripe.charges.retrieve(charge.id);
      const piId = typeof fresh.payment_intent === "string" ? fresh.payment_intent : fresh.payment_intent?.id;
      const booking = piId ? await bookingBy(db, "stripe_payment_intent_id", piId) : null;
      if (!booking) return "ignored: no booking for this charge";
      const refunded = Math.min(fresh.amount_refunded, booking.total_cents);
      const { error } = await db.from("bookings")
        .update({ refunded_cents: refunded, refunded_at: new Date().toISOString() })
        .eq("id", booking.id).lt("refunded_cents", refunded);
      if (error) throw new Error(error.message);
      return `refund recorded: ${refunded} cents`;
    }

    default:
      // Disputes and transfer reversals come with the payout and admin parts.
      return `ignored: ${event.type} isn't handled yet`;
  }
}
