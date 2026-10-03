import { serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

// The website's admin routes start with this (see adminRequest.ts).
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
    },
  );
  if (!check.ok) throw createError({ statusCode: check.status, statusMessage: check.message });
  return { adminId: check.userId, db };
}
