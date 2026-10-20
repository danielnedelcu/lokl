// POST /api/admin/providers/holds/retry-files: tries again to move or
// delete the files of hidden profile photos whose last try failed (admin
// roles step 5e), for anyone on the team. Admin app only.
export default defineEventHandler(async (event) => {
  const { db } = await requireAdminRequest(event);
  const unsettled = await settleHeldFiles(db);
  return { result: unsettled ? `${unsettled} still unsettled` : "settled" };
});
