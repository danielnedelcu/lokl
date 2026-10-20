import { z } from "zod";

// POST /api/admin/providers/holds/:id/decide { decision, note? }: the owner
// decides on hidden profile content (admin roles step 5e): remove (confirm
// it broke the rule), restore, or dismiss (only once the provider has
// replaced it). The database refuses support. Admin app only.
const body = z.object({
  decision: z.enum(["remove", "restore", "dismiss"]),
  note: z.string().max(1000).optional(),
});

export default defineEventHandler(async (event) => {
  const { adminId, db } = await requireAdminRequest(event);
  const input = await readValidatedBody(event, body.parse);
  const result = await answering(() => decideProfileHold(db, getRouterParam(event, "id")!, adminId, input));
  kickBookingEmails(event);
  return { result };
});
