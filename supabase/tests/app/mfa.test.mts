// The authenticator second factor on the LOCAL stack (docs/design/
// admin-roles.md, cutover step 1; `[auth.mfa.totp]` in supabase/config.toml):
// a login can enrol an authenticator, a correct code takes the session to
// aal2 and a wrong one is refused, and nothing requires it yet (a login
// with no factor works as before).
// Run: npx tsx supabase/tests/app/mfa.test.mts (part of db:test:app:core).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { totp } from "./_totp.mts";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const claim = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { aal?: string };

const created: string[] = [];
try {
  // Test logins on the local stack only, with a throwaway password.
  const password = randomBytes(18).toString("base64url");
  const signIn = async (label: string) => {
    const { data, error } = await db.auth.admin.createUser({ email: `mfa-${label}-${run}@test.local`, password, email_confirm: true });
    if (error) throw new Error(error.message);
    created.push(data.user.id);
    const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    const s = await client.auth.signInWithPassword({ email: data.user.email!, password });
    if (s.error) throw new Error(s.error.message);
    return client;
  };

  // 1. Enrol, and pass the second step.
  const a = await signIn("enrol");
  const before = (await a.auth.mfa.getAuthenticatorAssuranceLevel()).data;
  check(before?.currentLevel === "aal1" && before?.nextLevel === "aal1", "1a. signed in with no factor: aal1, nothing more asked");
  const enrolled = await a.auth.mfa.enroll({ factorType: "totp", friendlyName: "Test phone" });
  check(!enrolled.error && !!enrolled.data?.totp.secret && enrolled.data.totp.qr_code.startsWith("data:image/svg"),
    `1b. an authenticator can be enrolled, with a secret and a QR code${enrolled.error ? ` (${enrolled.error.message})` : ""}`);
  const factorId = enrolled.data!.id;
  const secret = enrolled.data!.totp.secret;
  const wrong = await a.auth.mfa.challengeAndVerify({ factorId, code: String((Number(totp(secret)) + 1) % 1_000_000).padStart(6, "0") });
  check(!!wrong.error, "1c. a wrong code is refused");
  const right = await a.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  check(!right.error, `1d. the right code is accepted${right.error ? ` (${right.error.message})` : ""}`);
  const session = (await a.auth.getSession()).data.session!;
  const after = (await a.auth.mfa.getAuthenticatorAssuranceLevel()).data;
  check(after?.currentLevel === "aal2" && claim(session.access_token).aal === "aal2", "1e. ...and the session is aal2, in its token too");
  // A second authenticator, as the design asks everyone to have.
  const second = await a.auth.mfa.enroll({ factorType: "totp", friendlyName: "Test backup" });
  if (!second.error) await a.auth.mfa.challengeAndVerify({ factorId: second.data.id, code: totp(second.data.totp.secret) });
  const factors = (await a.auth.mfa.listFactors()).data;
  check((factors?.totp ?? []).filter((f) => f.status === "verified").length === 2, "1f. a second authenticator can be added");

  // 2. Signing in again asks for the second step: aal1 now, aal2 next.
  const again = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
  const s = await again.auth.signInWithPassword({ email: `mfa-enrol-${run}@test.local`, password });
  const level = (await again.auth.mfa.getAuthenticatorAssuranceLevel()).data;
  check(!s.error && level?.currentLevel === "aal1" && level?.nextLevel === "aal2", "2. signing in again starts at aal1, with the second step to come");

  // 3. Nothing requires it yet: a login with no factor reads its own data as before.
  const b = await signIn("none");
  const own = await b.from("saved_listings").select("listing_id");
  check(!own.error, "3. a login with no factor works as before (nothing requires the second factor yet)");
} catch (e) {
  check(false, `setup or run: ${(e as Error).message}`);
} finally {
  for (const id of created) await db.auth.admin.deleteUser(id);
}

console.log(failures ? `${failures} failed` : "All second-factor checks passed.");
process.exit(failures ? 1 : 0);
