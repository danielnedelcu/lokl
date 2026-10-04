import { z } from "zod";

// POST /api/admin/providers/:id/remove-profile-content { parts, rule, reason, message? }:
// removes parts of a provider's public profile that break a profile rule
// (docs/design/provider-profiles.md). Admin app only. The reason is
// internal; the provider's email names what was removed and the rule, with
// lokl's optional message.
const body = z.object({
  parts: z.array(z.string()).min(1).max(4),
  rule: z.string(),
  reason: z.string(),
  message: z.string().max(1000).optional(),
});

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, body.parse);
  const result = await answering(() => removeProfileContent(db, getRouterParam(event, "id")!, adminId, input));
  kickBookingEmails(event);
  return { result };
});
