// Refreshes payout status straight from Stripe. Called when a provider returns
// from onboarding, so status is right even before the webhook arrives.
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  if (!provider.stripe_account_id) return getOwnProvider(event);

  const account = await useStripe().accounts.retrieve(provider.stripe_account_id);
  await syncStripeAccount(event, account);
  return getOwnProvider(event);
});
