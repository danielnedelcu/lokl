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
        // Prefills the business name on Stripe's onboarding form, so it
        // starts out matching the lokl profile.
        business_profile: { name: provider.display_name },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { provider_id: provider.id },
      },
      // A double click must not create two Stripe accounts for one provider.
      // The 10-minute window matters: Stripe replays a key's first result for
      // 24 hours, so a key fixed per provider would replay an error that long.
      { idempotencyKey: `connect-account-${provider.id}-${Math.floor(Date.now() / 600_000)}` },
    );
    accountId = account.id;

    // Only claim the slot if it's still empty, so a concurrent request can't
    // overwrite an account that was saved first.
    const supabase = serverSupabaseServiceRole(event);
    const { data: saved, error } = await supabase
      .from("providers")
      .update({ stripe_account_id: accountId })
      .eq("id", provider.id)
      .is("stripe_account_id", null)
      .select("id");
    if (error) throw createError({ statusCode: 500, statusMessage: error.message });

    if (!saved?.length) {
      // Another request saved an account first: use that one. Delete ours only
      // if it's a different account. Within one idempotency window both
      // requests receive the same account, and that one must be kept.
      const { data: current, error: readError } = await supabase
        .from("providers")
        .select("stripe_account_id")
        .eq("id", provider.id)
        .single();
      if (readError) throw createError({ statusCode: 500, statusMessage: readError.message });
      if (current.stripe_account_id !== accountId) {
        await stripe.accounts.del(accountId);
        accountId = current.stripe_account_id;
      }
    }
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${siteUrl}/dashboard/payouts?stripe=refresh`,
    return_url: `${siteUrl}/dashboard/payouts?stripe=return`,
  });
  return { url: link.url };
});
