// One-time link into the provider's Stripe Express dashboard (payouts, bank details).
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  if (!provider.stripe_account_id || !provider.stripe_details_submitted) {
    throw createError({ statusCode: 400, statusMessage: "Finish Stripe setup first" });
  }
  const link = await useStripe().accounts.createLoginLink(provider.stripe_account_id);
  return { url: link.url };
});
