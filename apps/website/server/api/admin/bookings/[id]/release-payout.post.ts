import { z } from "zod";

// POST /api/admin/bookings/:id/release-payout { reason }: clears a payout
// hold and pays out now if it's due. Admin app only.
const body = z.object({ reason: z.string() });

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const id = getRouterParam(event, "id")!;
  const { reason } = await readValidatedBody(event, body.parse);
  const result = await answering(() => releasePayout(db, useStripe(), id, adminId, reason));
  kickBookingEmails(event, id);
  return { result };
});
