import type { SupabaseClient } from "@supabase/supabase-js";
import { REVIEW_RULES } from "@repo/types";
import { BookingError } from "./bookings";
import { requireReason } from "./adminBookings";

// Review moderation (docs/design/reviews.md, Reporting and moderation):
// remove or restore a review or its reply under a written rule, or keep it
// (dismissing its open reports). One database function does the change,
// resolves the reports, logs it in admin_actions and queues the author's
// email, in one transaction.
export async function moderateReview(
  db: SupabaseClient, reviewId: string, adminId: string,
  input: { target: string; action: string; rule?: string | null; reason: string },
) {
  const reason = requireReason(input.reason);
  if (input.target !== "review" && input.target !== "reply") throw new BookingError("Choose the review or its reply.", 400);
  if (!["remove", "restore", "keep"].includes(input.action)) throw new BookingError("Choose remove, restore or keep.", 400);
  if (input.action === "remove" && !(input.rule && input.rule in REVIEW_RULES)) {
    throw new BookingError("Choose the review rule it breaks.", 400);
  }
  const { error } = await db.rpc("admin_moderate_review", {
    p_review_id: reviewId, p_admin_id: adminId, p_target: input.target, p_action: input.action,
    p_rule: input.action === "remove" ? input.rule! : null, p_reason: reason,
  });
  if (error) {
    if (error.code === "P0002") throw new BookingError(error.message, 404);
    if (error.code === "23514") throw new BookingError(error.message, 400);
    throw new Error(error.message);
  }
  return `${input.action} ${input.target}`;
}
