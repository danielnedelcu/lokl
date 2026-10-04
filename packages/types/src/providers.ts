import type { Database } from "./database";

export type ProviderStatus = "active" | "suspended";

// The providers table, from the generated types (database.ts), with its
// status narrowed to the values the database allows.
export type Provider = Omit<Database["public"]["Tables"]["providers"]["Row"], "status"> & { status: ProviderStatus };

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

// ---------------------------------------------------------------------------
// Profiles: contact details and the profile rules
// (docs/design/provider-profiles.md)
// ---------------------------------------------------------------------------

/**
 * Contact details in a profile headline or bio: an email, a web address, or
 * a phone number (7 or more digits with the usual separators). The same
 * rule as the database's has_contact_details(), which refuses them too; the
 * unit test and the pgTAP test use the same samples. Checked email first
 * (an email contains a web domain), then web, then phone.
 */
const CONTACT_PATTERNS = {
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  web: /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|io|co|us|biz|info|me|app|shop)\b/i,
  phone: /(\+?[0-9][ ().-]?){7,}/,
} as const;
export type ContactDetailKind = keyof typeof CONTACT_PATTERNS;

/** The first contact detail in the text, and what kind it looks like, or null. */
export function findContactDetails(text: string | null | undefined): { kind: ContactDetailKind; match: string } | null {
  for (const kind of ["email", "web", "phone"] as const) {
    const m = (text ?? "").match(CONTACT_PATTERNS[kind]);
    if (m) return { kind, match: m[0].trim() };
  }
  return null;
}

/**
 * What to tell the provider, naming what it looks like, so they know what to
 * change. A year range like "2015-2020" looks like a phone number too; the
 * message says how to write one.
 */
export function contactDetailsMessage(text: string | null | undefined): string | null {
  const found = findContactDetails(text);
  if (!found) return null;
  const quoted = `“${found.match}”`;
  switch (found.kind) {
    case "email":
      return `${quoted} looks like an email address. Leave it out: customers reach you through bookings.`;
    case "web":
      return `${quoted} looks like a web address. Leave links out: customers reach you through bookings.`;
    case "phone":
      return `${quoted} looks like a phone number. Leave phone numbers out: customers reach you through bookings. If it's a range of years, write it as “2015 to 2020”.`;
  }
}

/** The profile rules (the database lists the same keys). The admin names one in each removal. */
export const PROFILE_RULES = {
  contact_details: "Phone numbers, email addresses or web addresses. Customers reach providers through bookings.",
  private_information: "Anyone's private information: home addresses, or other people's names or photos without their consent.",
  abuse: "Abusive, hateful, harassing or sexually explicit content.",
  impersonation: "Pretending to be another business or person, or claiming awards, licences or affiliations the business doesn't have.",
  unsuitable_photo: "A photo that isn't of the business, its work or its people, or that's explicit, violent or misleading.",
  not_yours: "Photos or text the provider doesn't have the right to use.",
} as const;
export type ProfileRule = keyof typeof PROFILE_RULES;
