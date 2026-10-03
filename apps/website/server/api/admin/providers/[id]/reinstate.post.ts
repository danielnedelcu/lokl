import { z } from "zod";

// POST /api/admin/providers/:id/reinstate { reason }: reinstates a suspended provider:
// their listings show again (held payouts stay held until released). Admin app only.
// message: optional, lokl's words to the provider, added to their email.
const body = z.object({ reason: z.string(), message: z.string().max(1000).optional() });

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const { reason, message } = await readValidatedBody(event, body.parse);
  const result = await answering(() => setProviderStatus(db, useStripe(), getRouterParam(event, "id")!, "active", adminId, reason, message));
  kickBookingEmails(event);
  return { result };
});
