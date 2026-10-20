import { z } from "zod";

// POST /api/admin/providers/:id/hide-profile-content { parts, rule, reason, message? }:
// support or the owner hides parts of a provider's profile that break a
// profile rule (admin roles step 5e). Off the profile at once and kept for
// the owner's decision; a photo's files leave the public bucket. Admin app
// only. The reason is internal; the provider's email names what and the
// rule, with lokl's optional message.
const body = z.object({
  parts: z.array(z.string()).min(1).max(4),
  rule: z.string(),
  reason: z.string(),
  message: z.string().max(1000).optional(),
});

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, body.parse);
  const result = await answering(() => hideProfileContent(db, getRouterParam(event, "id")!, adminId, input));
  kickBookingEmails(event);
  return { result };
});
