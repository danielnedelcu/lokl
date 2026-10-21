import { z } from "zod";

// Support's requests to the owner, in words (admin roles, step 5b;
// docs/design/admin-roles.md, Requests): the bell, the owners' email and
// the Requests page say the same thing. Never the reason in a notice.

export type AdminRequestKind = "refund" | "release_payout" | "resolve_problem_paid" | "suspend_provider" | "reinstate_provider";
export type AdminRequestStatus = "pending" | "approved" | "declined" | "withdrawn" | "expired" | "done_by_owner";

/**
 * Only a fallback for a page that couldn't read admin_settings: pages show
 * the live limit from admin_settings, and the database decides.
 * admin-requests.test.mts checks this matches admin_settings' default.
 */
export const DEFAULT_REFUND_LIMIT_CENTS = 15000;

/** How long a request waits for the owner. */
export const ADMIN_REQUEST_DAYS = 7;

export interface AdminRequestSubject {
  kind: AdminRequestKind;
  resolveProblem?: boolean;
  amountCents?: number | null;
  /** The booking's listing, for a booking's request. */
  listingTitle?: string | null;
  providerName?: string | null;
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What is asked, after "to": "refund $195.00 for “Taco crawl” (Tours and Cuts)". */
export function adminRequestWhat(r: AdminRequestSubject): string {
  const provider = r.providerName || "the provider";
  const booking = r.listingTitle ? `“${r.listingTitle}” (${provider})` : `a booking with ${provider}`;
  switch (r.kind) {
    case "refund":
      return `refund ${dollars(r.amountCents ?? 0)} for ${booking}${r.resolveProblem ? ", resolving a no-show report" : ""}`;
    case "release_payout": return `release the held payout for ${booking}`;
    case "resolve_problem_paid": return `pay ${provider} for ${booking.replace(` (${provider})`, "")}, resolving a no-show report`;
    case "suspend_provider": return `suspend ${provider}`;
    case "reinstate_provider": return `reinstate ${provider}`;
  }
}

/** A new request, for the owners: "sam@example.com asks you to refund $195.00 for “Taco crawl” (Tours and Cuts)." */
export function adminRequestNewText(who: string, r: AdminRequestSubject): string {
  return `${who} asks you to ${adminRequestWhat(r)}.`;
}

/** A decision, for the person who asked: "The owner approved your request to suspend Tours and Cuts." */
export function adminRequestDecidedText(status: AdminRequestStatus, r: AdminRequestSubject): string {
  const what = adminRequestWhat(r);
  switch (status) {
    case "approved": return `The owner approved your request to ${what}.`;
    case "declined": return `The owner declined your request to ${what}.`;
    case "done_by_owner": return `The owner did it directly: your request to ${what} is closed.`;
    case "expired": return `Your request to ${what} expired without a decision.`;
    case "withdrawn": return `You withdrew your request to ${what}.`;
    case "pending": return `Your request to ${what} is waiting for the owner.`;
  }
}

/** A request's status in words, for its badge (never colour alone). */
export const ADMIN_REQUEST_STATUS_LABEL: Record<AdminRequestStatus, string> = {
  pending: "Waiting", approved: "Approved", declined: "Declined", withdrawn: "Withdrawn", expired: "Expired", done_by_owner: "Done by the owner",
};

// Daily limits and support's refunds (admin roles, step 5c): what the
// owners' bell and email say.

export type AdminLimitName = "refunds" | "refund_cents" | "contact_views" | "requests";
const LIMIT_WORDS: Record<AdminLimitName, string> = {
  refunds: "refunds", refund_cents: "the refund total", contact_views: "contact details", requests: "requests",
};

/** "sam@example.com reached today's limit for refunds." */
export function adminLimitReachedText(who: string, limit: AdminLimitName): string {
  return `${who} reached today's limit for ${LIMIT_WORDS[limit] ?? limit}.`;
}

/**
 * Each refund or cancellation by support, for the owners: "sam@example.com
 * refunded $130.00 and cancelled “Taco crawl” (Tours and Cuts)."
 */
export function adminSupportRefundText(
  who: string,
  r: { amountCents: number | null; resolvedReport: boolean; listingTitle?: string | null; providerName?: string | null },
): string {
  const provider = r.providerName || "the provider";
  const booking = r.listingTitle ? `“${r.listingTitle}” (${provider})` : `a booking with ${provider}`;
  if (r.amountCents && r.amountCents > 0) {
    return r.resolvedReport
      ? `${who} refunded ${dollars(r.amountCents)} for ${booking}, resolving a no-show report.`
      : `${who} refunded ${dollars(r.amountCents)} and cancelled ${booking}.`;
  }
  return `${who} cancelled ${booking}.`;
}

// Admin roles, step 5d: the owner's Settings page and the alerts it and
// listing review send.

/** The Settings page's form for the refund limit and support's daily limits, in dollars; the database's checks match these ranges. */
export const adminSettingsSchema = z.object({
  refundLimitDollars: z.coerce.number({ message: "Enter an amount." }).min(0, "At least $0.").max(10_000, "At most $10,000.")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use whole cents."),
  refundsPerDay: z.coerce.number({ message: "Enter a number." }).int("Use a whole number.").min(0, "At least 0.").max(1000, "At most 1,000."),
  refundDollarsPerDay: z.coerce.number({ message: "Enter an amount." }).min(0, "At least $0.").max(1_000_000, "At most $1,000,000.")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use whole cents."),
  contactViewsPerDay: z.coerce.number({ message: "Enter a number." }).int("Use a whole number.").min(0, "At least 0.").max(10_000, "At most 10,000."),
  requestsPerDay: z.coerce.number({ message: "Enter a number." }).int("Use a whole number.").min(0, "At least 0.").max(10_000, "At most 10,000."),
  reason: z.string().trim().min(5, "Say why, in a few words.").max(1000, "Keep the reason under 1,000 characters."),
});
export type AdminSettingsInput = z.input<typeof adminSettingsSchema>;

/** "sam@example.com took down “Taco crawl”." (support only; the owners are told). */
export function adminListingTakenDownText(who: string, listingTitle: string | null | undefined): string {
  return `${who} took down ${listingTitle ? `“${listingTitle}”` : "a listing"}.`;
}

/** "sam@example.com changed the settings: Refund limit $150.00 to $200.00." */
export function adminSettingsChangeText(who: string, what: string | null | undefined): string {
  return what ? `${who} changed the settings: ${what}` : `${who} changed the settings.`;
}

// Admin roles, step 5e: support hid part of a provider's profile.

/** "sam@example.com hid the headline and profile photo of Tours and Cuts." (for the owners; never the reason). */
export function adminProfileHiddenText(who: string, providerName: string | null | undefined, parts: string[]): string {
  const words: Record<string, string> = { avatar: "profile photo", cover: "cover photo", headline: "headline", bio: "about text" };
  const order = Object.keys(words);
  const list = [...parts].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => words[p] ?? p);
  const what = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "part of the profile");
  return `${who} hid the ${what} of ${providerName || "a provider"}. It's waiting for you on Requests.`;
}

// The job scheduler (2026-10-21): hidden content waiting 7 days, for the owners.

/** "Hidden profile content from Tours and Cuts (its headline) has waited 7 days for you." */
export function adminProfileHiddenOverdueText(providerName: string | null | undefined, parts: string[]): string {
  const words: Record<string, string> = { avatar: "profile photo", cover: "cover photo", headline: "headline", bio: "about text" };
  const order = Object.keys(words);
  const list = [...parts].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => words[p] ?? p);
  const what = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "part of their profile");
  return `Hidden profile content from ${providerName || "a provider"} (its ${what}) has waited 7 days for you. It stays hidden until you decide.`;
}
