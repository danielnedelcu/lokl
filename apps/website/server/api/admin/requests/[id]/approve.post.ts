import { z } from "zod";

// POST /api/admin/requests/:id/approve { expectedAmountCents? }: the owner
// approves a support member's request (adminRequests.ts). Admin app only;
// the database checks it's the owner again. A refund's expected amount, what
// the owner was shown, is required: without it, or if it has changed,
// nothing is done and the answer says why.
const body = z.object({ expectedAmountCents: z.number().int().min(0).nullish() });

export default defineEventHandler(async (event) => {
  const { adminId, role, db } = await requireAdminRequest(event);
  if (role !== "owner") throw createError({ statusCode: 403, statusMessage: "Only the owner can approve a request." });
  const { expectedAmountCents } = await readValidatedBody(event, body.parse);
  const result = await answering(() => approveRequest(db, useStripe(), adminId, getRouterParam(event, "id")!, expectedAmountCents));
  kickBookingEmails(event);
  return { result };
});
