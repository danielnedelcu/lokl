import { supportNoteSchema } from "@repo/types";

// POST /api/admin/support-reports/:id/notes { body }: an admin's private
// note on a problem report, which the provider never sees. Admin app only.
export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, supportNoteSchema.parse);
  const id = await supportAnswering(() => adminNote(db, getRouterParam(event, "id")!, adminId, input.body));
  return { id };
});
