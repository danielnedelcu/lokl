import type { H3Event } from "h3";
import { serverSupabaseClient, serverSupabaseSession, serverSupabaseUser } from "#supabase/server";
import { tokenClaims } from "@repo/types";

// Call at the top of every admin server route before touching data. The role
// is the database's, live (admin_role(): an active team member on a session
// that passed the second factor; docs/design/admin-roles.md), never the
// sign-in token's. `db` is the server key acting for this admin's session,
// for the admin functions that check it (admin_role_of()). `owner: true`
// refuses support (guides, the homepage); the database checks it again.
export async function requireAdmin(event: H3Event, opts: { owner?: boolean } = {}) {
  const user = await serverSupabaseUser(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Sign in required" });
  }
  const session = await serverSupabaseSession(event);
  const token = session?.access_token;
  const role = token ? await adminRoleFor(event, token) : null;
  if (!role) {
    throw createError({ statusCode: 403, statusMessage: "Admins only, after the second sign-in step" });
  }
  if (opts.owner && role !== "owner") {
    throw createError({ statusCode: 403, statusMessage: "Only the owner can do this." });
  }
  const sessionId = tokenClaims(token!).session_id;
  if (!sessionId) throw createError({ statusCode: 401, statusMessage: "Your sign-in has expired. Sign in again." });
  return { ...user, role, db: serviceClientForAdmin(event, sessionId), client: await serverSupabaseClient(event) };
}
