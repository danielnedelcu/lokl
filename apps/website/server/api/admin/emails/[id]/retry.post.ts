// POST /api/admin/emails/:id/retry: sends a failed or skipped booking email
// again (it goes back in the queue, then out straight away). Admin app only.
export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const bookingId = await answering(() => retryEmail(db, getRouterParam(event, "id")!, adminId));
  kickBookingEmails(event, bookingId);
  return { result: "queued" };
});
