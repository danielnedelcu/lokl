// Admin calls to the website (decision 14): checkAdminRequest
// (apps/website/server/utils/adminRequest.ts) with real tokens from the
// LOCAL stack, every case in the design's table. Then the CORS preflight
// against the running website dev server, if it's up (no data is touched).
// Run: npx tsx supabase/tests/app/admin-request.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checkAdminRequest } from "../../../apps/website/server/utils/adminRequest";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ADMIN_ORIGIN = "http://localhost:3101";
const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const created: string[] = [];
const deps = {
  adminOrigin: ADMIN_ORIGIN,
  getUser: async (token: string) => {
    const { data, error } = await db.auth.getUser(token);
    return error ? null : data.user;
  },
};
const ask = (origin: string | undefined, token: string | undefined) =>
  checkAdminRequest({ origin, authorization: token === undefined ? undefined : `Bearer ${token}` }, deps);

try {
  // Test logins on the local stack only, with a throwaway password.
  const password = randomBytes(18).toString("base64url");
  const signIn = async (label: string, admin: boolean) => {
    const { data, error } = await db.auth.admin.createUser({
      email: `admin-req-${label}-${run}@test.local`, password, email_confirm: true,
      app_metadata: admin ? { role: "admin" } : {},
    });
    if (error) throw new Error(error.message);
    created.push(data.user.id);
    const client = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    const { data: s, error: e } = await client.auth.signInWithPassword({ email: data.user.email!, password });
    if (e) throw new Error(e.message);
    return { token: s.session!.access_token, client };
  };
  const admin = await signIn("admin", true);
  const user = await signIn("user", false);

  const a = await ask(ADMIN_ORIGIN, undefined);
  check(!a.ok && a.status === 401, "1. no token: 401");
  const b = await ask(ADMIN_ORIGIN, user.token);
  check(!b.ok && b.status === 403, "2. a valid token that isn't an admin's: 403");
  const c1 = await ask(undefined, admin.token);
  const c2 = await ask("https://evil.example", admin.token);
  const c3 = await ask("http://localhost:3100", admin.token);
  check([c1, c2, c3].every((c) => !c.ok && c.status === 403), "3. an admin token with no Origin, another site's, or the website's own: 403");
  const forged = admin.token.slice(0, -4) + (admin.token.endsWith("AAAA") ? "BBBB" : "AAAA");
  const d1 = await ask(ADMIN_ORIGIN, forged);
  const d2 = await ask(ADMIN_ORIGIN, "not-a-token");
  check([d1, d2].every((d) => !d.ok && d.status === 401), "4a. a forged or made-up token: 401");
  const ok = await ask(ADMIN_ORIGIN, admin.token);
  check(ok.ok === true, "5. an admin token from the admin app's address: allowed");
  // Signed out: the token's session no longer exists, so Supabase refuses it.
  await admin.client.auth.signOut({ scope: "global" });
  const e = await ask(ADMIN_ORIGIN, admin.token);
  check(!e.ok && e.status === 401, "4b. a token whose sign-in has ended: 401");
  const f = await checkAdminRequest({ origin: ADMIN_ORIGIN, authorization: `Bearer ${user.token}` }, { ...deps, adminOrigin: "" });
  check(!f.ok && f.status === 403, "6. with no admin origin configured, every call is refused");

  // CORS, against the running website (if it's up). A preflight touches no data.
  const preflight = (origin: string) => fetch("http://localhost:3100/api/admin/bookings/00000000-0000-4000-8000-000000000000/cancel", {
    method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" },
  });
  const other = await preflight("https://evil.example").catch(() => null);
  if (!other) {
    console.log("skip 7. the website dev server isn't running, so the CORS checks didn't run");
  } else {
    check(!other.headers.get("access-control-allow-origin"), "7a. a preflight from another site gets no CORS allowance");
    const mine = await preflight(ADMIN_ORIGIN);
    const allow = mine.headers.get("access-control-allow-origin");
    if (allow === null) {
      console.log("skip 7b. the website doesn't allow the admin app yet: restart its dev server so it reads NUXT_ADMIN_ORIGIN");
    } else {
      check(allow === ADMIN_ORIGIN && mine.headers.get("access-control-allow-credentials") !== "true",
        "7b. a preflight from the admin app is allowed, for that origin only and without credentials");
    }
    const post = await fetch("http://localhost:3100/api/admin/bookings/00000000-0000-4000-8000-000000000000/cancel", {
      method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}",
    });
    check(post.status === 403, `7c. a POST from another site is refused by the route itself (${post.status})`);
  }
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message}`);
} finally {
  for (const id of created) await db.auth.admin.deleteUser(id);
}
console.log(failures ? `${failures} failed` : "All admin request checks passed.");
process.exit(failures ? 1 : 0);
