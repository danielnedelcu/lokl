import { SUPPORT_STATUSES, SUPPORT_STATUS_FOR_ADMIN, SUPPORT_STATUS_FOR_PROVIDER, type SupportStatus } from "@repo/types";

// The one place status labels are defined (docs/frontend.md): StatusBadge
// draws them, and searches match the same words people see.
export const STATUS_LABELS = {
  payouts: { not_started: "Not started", in_progress: "In progress", ready: "Ready" },
  provider: { active: "Active", suspended: "Suspended" },
  // Admin reference lists (cities, service areas, categories).
  record: { active: "Active", inactive: "Inactive" },
  // Listings: plain words, not the database's status names.
  listing: {
    draft: "Draft",
    submitted: "In review",
    live: "Live",
    rejected: "Needs changes",
    unpublished: "Taken down",
  },
  // Destination guides (guideState() in @repo/types).
  guide: { draft: "Draft", published: "Published", changes: "Changes not published", unpublished: "Unpublished" },
  // Experience sessions.
  session: { scheduled: "Scheduled", cancelled: "Cancelled" },
  // Bookings, as the customer sees them.
  booking: {
    pending_payment: "Waiting for payment",
    requested: "Waiting for the provider",
    confirmed: "Confirmed",
    declined: "Declined",
    // Never "Ended" or "Done": an expired booking never took place.
    expired: "Expired",
    cancelled: "Cancelled",
    completed: "Done",
    paid_out: "Done",
  },
  // Bookings, as the admin sees them.
  adminBooking: {
    pending_payment: "In checkout",
    requested: "Waiting for provider",
    confirmed: "Confirmed",
    declined: "Declined",
    expired: "Expired",
    cancelled: "Cancelled",
    completed: "Happened",
    paid_out: "Paid out",
  },
  // Reviews and replies (docs/design/reviews.md).
  review: { published: "Published", removed: "Removed" },
  // Bookings, as the provider sees them.
  providerBooking: {
    requested: "Needs your answer",
    confirmed: "Confirmed",
    declined: "Declined",
    expired: "Expired",
    cancelled: "Cancelled",
    completed: "Done",
    paid_out: "Paid out",
  },
  // Problem reports, as the provider sees them, and as the admin's board
  // names its columns (docs/design/problem-reports.md; the words live in
  // @repo/types, beside each status's sentence).
  supportReport: Object.fromEntries(SUPPORT_STATUSES.map((s) => [s, SUPPORT_STATUS_FOR_PROVIDER[s].label])) as Record<SupportStatus, string>,
  supportBoard: SUPPORT_STATUS_FOR_ADMIN,
} as const;

export type StatusKind = keyof typeof STATUS_LABELS;

/** A status in words, as StatusBadge shows it. */
export function statusLabel(kind: StatusKind, status: string): string {
  return (STATUS_LABELS[kind] as Record<string, string>)[status] ?? status;
}
