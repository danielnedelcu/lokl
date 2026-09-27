import type { H3Event } from "h3";
import { serverSupabaseUser } from "#supabase/server";
import { isAdmin } from "@repo/types";

// Call at the top of every admin server route before touching data.
export async function requireAdmin(event: H3Event) {
  const user = await serverSupabaseUser(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Sign in required" });
  }
  if (!isAdmin(user)) {
    throw createError({ statusCode: 403, statusMessage: "Admins only" });
  }
  return user;
}
