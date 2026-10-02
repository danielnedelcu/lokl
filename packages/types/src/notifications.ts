// Provider notifications (docs/design/notifications.md). The sentence is
// built here at display time, from the kind and the listing's current title,
// so the wording changes in one place and a renamed listing reads correctly.

export type NotificationKind =
  | "listing_approved" | "listing_rejected" | "listing_unpublished" | "listing_restored"
  | "booking_requested" | "booking_confirmed" | "booking_cancelled";

export function notificationText(kind: NotificationKind, title: string): string {
  const t = `“${title}”`;
  switch (kind) {
    case "listing_approved":
      return `${t} was approved and is live.`;
    case "listing_rejected":
      return `lokl sent back ${t}. See what to change.`;
    case "listing_unpublished":
      return `lokl took down ${t}. See why.`;
    case "listing_restored":
      return `${t} is live again.`;
    case "booking_requested":
      return `New request for ${t}. Accept or decline it.`;
    case "booking_confirmed":
      return `New booking for ${t}.`;
    case "booking_cancelled":
      return `A booking for ${t} was cancelled.`;
  }
}

/** The unread count as shown on the bell: 1 to 9, then "9+". */
export function unreadBadge(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/** The bell's accessible name: "Notifications, 2 unread", "Notifications, more than 9 unread". */
export function bellLabel(count: number): string {
  if (count <= 0) return "Notifications";
  return count > 9 ? "Notifications, more than 9 unread" : `Notifications, ${count} unread`;
}
