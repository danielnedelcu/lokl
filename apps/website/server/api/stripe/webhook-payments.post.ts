import type Stripe from "stripe";
import { serverSupabaseServiceRole } from "#supabase/server";

// Events on lokl's own Stripe account: booking payments
// (docs/design/booking-and-checkout.md, Webhooks). A separate endpoint from
// /api/stripe/webhook (connected-account events), with its own signing
// secret: NUXT_STRIPE_PAYMENTS_WEBHOOK_SECRET. In the Stripe dashboard, add it
// under "Events on your account" with checkout.session.completed,
// checkout.session.expired, checkout.session.async_payment_succeeded and
// _failed, payment_intent.canceled and charge.refunded.
export default defineEventHandler(async (event) => {
  const { stripePaymentsWebhookSecret } = useRuntimeConfig();
  const signature = getHeader(event, "stripe-signature");
  const payload = await readRawBody(event, "utf8");
  if (!stripePaymentsWebhookSecret || !signature || !payload) {
    throw createError({ statusCode: 400, statusMessage: "Invalid webhook request" });
  }

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = verifyPaymentsEvent(useStripe(), payload, signature, stripePaymentsWebhookSecret);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid signature" });
  }

  // A failure answers 500, so Stripe retries the event later.
  const result = await handlePaymentsEvent(serverSupabaseServiceRole(event), useStripe(), stripeEvent);
  console.info(`[webhook-payments] ${stripeEvent.type} ${stripeEvent.id}: ${result}`);
  return { received: true };
});
