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
