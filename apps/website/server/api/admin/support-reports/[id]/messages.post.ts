import { supportAdminReplySchema } from "@repo/types";

// POST /api/admin/support-reports/:id/messages { body, wait }: lokl's reply
// on a problem report (docs/design/problem-reports.md), and with `wait`
// "Reply and wait for their answer". Admin app only. The provider's email
// goes out at once.
export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, supportAdminReplySchema.parse);
  const status = await supportAnswering(() => adminReply(db, getRouterParam(event, "id")!, adminId, input.body, input.wait));
  kickBookingEmails(event);
  return { status };
});
