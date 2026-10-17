import { supportMoveSchema } from "@repo/types";

// POST /api/admin/support-reports/:id/status { to, from }: "Move to…" (and
// drag and drop) on the board or the report's page. Refused if the report
// has left `from` (someone else moved it). Admin app only.
export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, supportMoveSchema.parse);
  const status = await supportAnswering(() => adminMove(db, getRouterParam(event, "id")!, adminId, input.to, input.from ?? null));
  return { status };
});
