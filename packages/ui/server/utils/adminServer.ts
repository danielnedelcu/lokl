import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_SESSION_HEADER, type AdminRole, type Database } from "@repo/types";

// Both apps' servers acting for an admin (docs/design/admin-roles.md, cutover
// step 4). The role is never read from the sign-in token: the database's
// admin_role() answers it live, asked with the admin's own token, so a
// removed admin, a session signed out, or one that hasn't passed the second
// factor gets nothing. The server-only admin functions check the session the
// server names in the x-lokl-admin-session header (admin_role_of()), which
// they accept only from the server key.

type Event = Parameters<typeof useRuntimeConfig>[0];

/** The admin's live role, asked with their own (verified) token; null if they aren't one now. */
export async function adminRoleFor(event: Event, token: string): Promise<AdminRole | null> {
  const config = useRuntimeConfig(event);
  const asThem = createClient<Database>(config.public.supabase.url, config.public.supabase.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asThem.rpc("admin_role", {}, { get: true });
  if (error) return null;
  return data === "owner" || data === "support" ? data : null;
}

/** A server-key client acting for this admin session (named in the header admin_role_of() reads). */
export function serviceClientForAdmin(event: Event, sessionId: string): SupabaseClient<Database> {
  const config = useRuntimeConfig(event);
  const serverKey = config.supabase.secretKey || config.supabase.serviceKey;
  if (!serverKey) throw new Error("Missing server key. Set NUXT_SUPABASE_SECRET_KEY.");
  return createClient<Database>(config.public.supabase.url, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { [ADMIN_SESSION_HEADER]: sessionId } },
  });
}
