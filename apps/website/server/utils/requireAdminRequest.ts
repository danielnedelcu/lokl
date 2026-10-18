import { serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

// The website's admin routes start with this (see adminRequest.ts). Their
// `db` is the server key acting for the admin's session.
export async function requireAdminRequest(event: ServerEvent) {
  const db = serverSupabaseServiceRole(event);
  const check = await checkAdminRequest(
    { origin: getHeader(event, "origin"), authorization: getHeader(event, "authorization") },
    {
      adminOrigin: useRuntimeConfig().adminOrigin,
      getUser: async (token) => {
        const { data, error } = await db.auth.getUser(token);
        return error ? null : data.user;
      },
      getRole: (token) => adminRoleFor(event, token),
    },
  );
  if (!check.ok) throw createError({ statusCode: check.status, statusMessage: check.message });
  // The server key, naming this admin's session to the admin functions
  // (admin_role_of(); docs/design/admin-roles.md).
  return { adminId: check.userId, role: check.role, db: serviceClientForAdmin(event, check.sessionId) };
}
