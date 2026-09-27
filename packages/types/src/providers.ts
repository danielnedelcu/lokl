// Mirrors the providers and cities tables in supabase/migrations/. Replace
// with generated types (see database.ts) once the schema settles.
export type ProviderStatus = "active" | "suspended";

export interface Provider {
  id: string;
  owner_id: string;
  display_name: string;
  city_id: string;
  status: ProviderStatus;
  stripe_account_id: string | null;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// A place lokl operates. Only active cities are visible outside the admin app.
export interface City {
  id: string;
  slug: string;
  name: string;
  state: string;
  timezone: string;
  active: boolean;
  sort_order: number;
}

// Where a provider is in Stripe Connect onboarding, for display.
export type PayoutSetup = "not_started" | "in_progress" | "ready";

export function payoutSetupOf(p: Pick<Provider, "stripe_account_id" | "stripe_charges_enabled" | "stripe_payouts_enabled">): PayoutSetup {
  if (!p.stripe_account_id) return "not_started";
  return p.stripe_charges_enabled && p.stripe_payouts_enabled ? "ready" : "in_progress";
}
