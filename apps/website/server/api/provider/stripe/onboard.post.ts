import { serverSupabaseServiceRole } from "#supabase/server";

// Starts or resumes Stripe Connect onboarding, returning a Stripe-hosted URL.
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const user = await requireUser(event);
  const stripe = useStripe();
  const { siteUrl } = useRuntimeConfig().public;

  let accountId = provider.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create(
      {
        type: "express",
        country: "US",
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { provider_id: provider.id },
      },
      // A double click must not create two Stripe accounts for one provider.
      { idempotencyKey: `connect-account-${provider.id}` },
    );
    accountId = account.id;

    const { error } = await serverSupabaseServiceRole(event)
      .from("providers")
      .update({ stripe_account_id: accountId })
      .eq("id", provider.id);
    if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${siteUrl}/dashboard/payouts?stripe=refresh`,
    return_url: `${siteUrl}/dashboard/payouts?stripe=return`,
  });
  return { url: link.url };
});
