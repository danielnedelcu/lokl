import { z } from "zod";

// POST /api/admin/bookings/:id/cancel { reason, resolveProblem? }: lokl
// cancels a booking, refunding in full (and reversing the provider's
// transfer after a payout). With resolveProblem, it's the refund outcome of
// a no-show report. Admin app only (requireAdminRequest).
const body = z.object({ reason: z.string(), resolveProblem: z.boolean().optional() });

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const id = getRouterParam(event, "id")!;
  const { reason, resolveProblem } = await readValidatedBody(event, body.parse);
  const result = await answering(() => adminCancelBooking(db, useStripe(), id, adminId, reason, { resolveProblem }));
  kickBookingEmails(event, id);
  return { result };
});
