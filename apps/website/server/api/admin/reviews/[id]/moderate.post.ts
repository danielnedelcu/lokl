import { z } from "zod";

// POST /api/admin/reviews/:id/moderate { target, action, rule?, reason }:
// remove or restore a review or its reply under a written review rule, or
// keep it, dismissing its open reports (docs/design/reviews.md). Admin app
// only. The reason is internal; the author's email names the rule.
const body = z.object({
  target: z.enum(["review", "reply"]),
  action: z.enum(["remove", "restore", "keep"]),
  rule: z.string().nullish(),
  reason: z.string(),
});

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, body.parse);
  const result = await answering(() => moderateReview(db, getRouterParam(event, "id")!, adminId, input));
  kickBookingEmails(event);
  return { result };
});
