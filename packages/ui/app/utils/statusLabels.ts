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
    expired: "Didn't go through",
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
    expired: "Ended",
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
    expired: "Ended",
    cancelled: "Cancelled",
    completed: "Done",
    paid_out: "Paid out",
  },
} as const;

export type StatusKind = keyof typeof STATUS_LABELS;

/** A status in words, as StatusBadge shows it. */
export function statusLabel(kind: StatusKind, status: string): string {
  return (STATUS_LABELS[kind] as Record<string, string>)[status] ?? status;
}
