import type Stripe from "stripe";

// Receives events about connected accounts. In the Stripe dashboard, add this
// endpoint under "Events on connected accounts" and subscribe to account.updated.
export default defineEventHandler(async (event) => {
  const { stripeWebhookSecret } = useRuntimeConfig();
  const signature = getHeader(event, "stripe-signature");
  const payload = await readRawBody(event, "utf8");
  if (!stripeWebhookSecret || !signature || !payload) {
    throw createError({ statusCode: 400, statusMessage: "Invalid webhook request" });
  }

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = useStripe().webhooks.constructEvent(payload, signature, stripeWebhookSecret);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid signature" });
  }

  if (stripeEvent.type === "account.updated") {
    await syncStripeAccount(event, stripeEvent.data.object);
  }
  return { received: true };
});
