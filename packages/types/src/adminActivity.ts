// The team's actions in plain words (admin roles step 5d): the Activity
// page, a booking's History and the alerts say what happened the same way.
// Every action the database may log (admin_actions_action_check) has a
// phrase here; the admin-activity app test fails if the two lists differ.

export const ADMIN_ACTION_LABELS = {
  cancel_booking: "cancelled a booking",
  release_payout: "released a payout",
  resolve_problem_paid: "resolved a problem report, paying the provider",
  resolve_problem_refunded: "resolved a problem report with a refund",
  retry_email: "sent an email again",
  suspend_provider: "suspended a provider",
  reinstate_provider: "reinstated a provider",
  remove_profile_content: "removed part of a provider's profile",
  remove_review: "removed a review",
  restore_review: "restored a review",
  remove_review_reply: "removed a review reply",
  restore_review_reply: "restored a review reply",
  dismiss_review_reports: "dismissed reports on a review",
  support_reply: "replied to a problem report",
  support_reply_wait: "replied to a problem report and is waiting to hear back",
  support_move: "moved a problem report",
  support_note: "added a note to a problem report",
  invite_admin: "invited someone to the team",
  change_admin_role: "changed someone's role",
  remove_admin: "removed someone from the team",
  reset_admin_mfa: "reset someone's authenticator",
  join_admin: "joined the team",
  break_glass_owner: "was made an owner in an emergency",
  request_action: "approved a request",
  decline_request: "declined a request",
  withdraw_request: "withdrew a request",
  limit_reached: "reached a daily limit",
  approve_listing: "approved a listing",
  reject_listing: "sent a listing back",
  unpublish_listing: "took a listing down",
  restore_listing: "restored a listing",
  publish_guide: "published a guide",
  unpublish_guide: "unpublished a guide",
  set_homepage_features: "chose the homepage's guides",
  change_admin_settings: "changed support's limits",
  add_category: "added a category",
  change_category: "changed a category",
  add_market: "added a market",
  change_market: "changed a market",
  add_area: "added an area",
  change_area: "changed an area",
  hide_profile_content: "hid part of a provider's profile",
  confirm_profile_removal: "confirmed removing part of a provider's profile",
  restore_profile_content: "restored part of a provider's profile",
  dismiss_profile_hold: "dismissed hidden profile content the provider had replaced",
} as const;
export type AdminActionName = keyof typeof ADMIN_ACTION_LABELS;

/** "cancelled a booking"; an action this app doesn't know yet reads as its name, never blank. */
export function adminActionLabel(action: string): string {
  return (ADMIN_ACTION_LABELS as Record<string, string>)[action] ?? action.replace(/_/g, " ");
}

/** Where an action's subject is in the admin app, when it has a page. */
export function adminActionLink(target: string, targetId: string | null): string | null {
  if (target === "settings") return "/settings";
  if (target === "homepage") return "/content/homepage";
  if (!targetId) return null;
  switch (target) {
    case "booking": return `/bookings/${targetId}`;
    case "listing": return `/listings/${targetId}`;
    case "guide": return `/content/${targetId}`;
    case "support_report": return `/reports/${targetId}`;
    case "admin_request": return "/requests";
    case "admin_member": return "/team";
    case "provider": return `/providers/${targetId}`;
    case "category": return "/categories";
    case "market": case "area": return "/cities";
    default: return null;
  }
}

/** Who moved a booking, in words (booking_events.actor). */
export const BOOKING_ACTOR_LABELS: Record<string, string> = {
  customer: "the customer",
  provider: "the provider",
  admin: "lokl's team",
  system: "lokl, automatically",
  stripe: "Stripe",
};
