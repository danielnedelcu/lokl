// Test helper: an admin as lokl now has them (docs/design/admin-roles.md):
// a team member (admin_members), signed in on a session that passed the
// second factor, with an authenticator set up for the purpose. Returns their
// own client (for reads through the API, as the admin app makes them) and a
// server-key client acting for their session (the header admin_role_of()
// reads), as the website's admin routes use. Local stack, test logins only.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_SESSION_HEADER, tokenClaims, type AdminRole, type Database } from "@repo/types";
import { totp } from "./_totp.mts";

export interface TestAdmin {
  id: string;
  email: string;
  /** Their own client, on a session that passed the second factor. */
  client: SupabaseClient<Database>;
  token: string;
  sessionId: string;
  /** The server key, acting for this admin's session. */
  server: SupabaseClient<Database>;
}

// The admins this process made, for forgetTestAdmins().
const made: { dbUrl: string; id: string }[] = [];

export async function makeAdmin(
  local: { API_URL?: string; ANON_KEY?: string; SERVICE_ROLE_KEY?: string; DB_URL?: string },
  email: string,
  { role = "owner" as AdminRole } = {},
): Promise<TestAdmin> {
  const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const password = randomBytes(18).toString("base64url");
  const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  const id = created.user.id;
  if (local.DB_URL) made.push({ dbUrl: local.DB_URL, id });
  const member = await db.from("admin_members").insert({ user_id: id, role, status: "active", joined_at: new Date().toISOString() });
  if (member.error) throw new Error(member.error.message);
  const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(signedIn.error.message);
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Test" });
  if (enrolled.error) throw new Error(enrolled.error.message);
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) });
  if (verified.error) throw new Error(verified.error.message);
  const token = (await client.auth.getSession()).data.session!.access_token;
  const sessionId = tokenClaims(token).session_id!;
  const server = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { [ADMIN_SESSION_HEADER]: sessionId } },
  });
  return { id, email, client, token, sessionId, server };
}

/**
 * Clean-up: the team rows of the admins this process made, and their logins.
 * Team members are never deleted, and a login on the team can't be, so this
 * goes round the guard as the project's other test clean-up does (the
 * owner's replica switch), on the LOCAL database only. Call it before a
 * test deletes its other logins.
 */
export function forgetTestAdmins() {
  for (const { dbUrl, id } of made.splice(0)) {
    if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(dbUrl)) continue;
    execFileSync("psql", [dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "-c",
      `set session_replication_role = replica; delete from public.admin_members where user_id = '${id}'; delete from auth.users where id = '${id}';`]);
  }
}
