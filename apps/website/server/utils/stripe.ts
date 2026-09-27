import Stripe from "stripe";
import { serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

let client: Stripe | undefined;

export function useStripe() {
  if (!client) {
    const { stripeSecretKey } = useRuntimeConfig();
    if (!stripeSecretKey) {
      throw createError({ statusCode: 500, statusMessage: "Stripe is not configured" });
    }
    client = new Stripe(stripeSecretKey);
  }
  return client;
}

// Copies a connected account's onboarding state onto its provider row.
// Stripe is the source of truth; only the service role may write these columns.
export async function syncStripeAccount(event: ServerEvent, account: Stripe.Account) {
  const { error } = await serverSupabaseServiceRole(event)
    .from("providers")
    .update({
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_payouts_enabled: account.payouts_enabled ?? false,
    })
    .eq("stripe_account_id", account.id);
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
}
