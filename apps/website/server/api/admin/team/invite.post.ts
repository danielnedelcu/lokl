import { adminInviteSchema } from "@repo/types";

// POST /api/admin/team/invite { email, role, reason }: the owner invites
// someone to the admin team (adminTeam.ts). Admin app only; the database
// checks it's the owner again. The invitation and the owners' alerts go
// out at once.
export default defineEventHandler(async (event) => {
  const { adminId, role, db } = await requireAdminRequest(event);
  if (role !== "owner") throw createError({ statusCode: 403, statusMessage: "Only the owner can invite someone to the team." });
  const input = await readValidatedBody(event, adminInviteSchema.parse);
  const userId = await answering(() => inviteToTeam(db, adminId, input));
  kickBookingEmails(event);
  return { result: "invited", userId };
});
