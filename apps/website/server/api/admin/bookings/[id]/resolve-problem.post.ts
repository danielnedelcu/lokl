import { z } from "zod";

// POST /api/admin/bookings/:id/resolve-problem { outcome, reason }: a
// no-show report, resolved in the provider's favour ("pay_provider": the
// payout goes ahead) or with a full refund ("refund": the booking is
// cancelled). Both sides are emailed the outcome. Admin app only.
const body = z.object({ outcome: z.enum(["pay_provider", "refund"]), reason: z.string() });

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const id = getRouterParam(event, "id")!;
  const { outcome, reason } = await readValidatedBody(event, body.parse);
  const result = await answering(() => outcome === "refund"
    ? adminCancelBooking(db, useStripe(), id, adminId, reason, { resolveProblem: true })
    : resolveProblemPaid(db, useStripe(), id, adminId, reason));
  kickBookingEmails(event, id);
  return { result };
});
