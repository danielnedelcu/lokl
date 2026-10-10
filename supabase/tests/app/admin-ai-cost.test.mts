// The admin's "AI drafting this month" line (apps/admin/app/utils/
// aiDraftCost.ts), read as an admin against the LOCAL stack. Recreates the
// cut-off found on 2026-10-10: the page read the month's drafts and added
// up their cost in the browser, so past the API's 1,000 rows it showed too
// few drafts and too low a cost.
// Run: npx tsx supabase/tests/app/admin-ai-cost.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { aiDraftCostSince } from "../../../apps/admin/app/utils/aiDraftCost";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const users: string[] = [];
// A start in the future, so only this test's drafts (dated after it) count.
const since = new Date(Date.now() + 365 * 864e5).toISOString();

try {
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string, admin = false) => {
    const { user } = await must(db.auth.admin.createUser({
      email: `aicost-${label}-${run}@test.local`, password, email_confirm: true, ...(admin ? { app_metadata: { role: "admin" } } : {}),
    }));
    users.push(user.id);
    const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return client;
  };
  const admin = await login("admin", true);
  const someone = await login("someone");
  psql(`insert into public.guide_ai_drafts (topic, model, cost_usd, created_at)
    select 'AI cost test ${run} ' || g, 'test-model', 0.0125, '${since}'::timestamptz + interval '1 day' from generate_series(1, 1200) g;`);

  const cost = await aiDraftCostSince(admin, since);
  check(cost.count === 1200, `1a. all 1,200 drafts are counted (got ${cost.count})`);
  check(cost.cents === 1500, `1b. ...and their cost added up: $15.00 (got ${cost.cents} cents)`);
  const none = await aiDraftCostSince(someone, since);
  check(none.count === 0 && none.cents === 0, "2. someone who isn't an admin sees nothing");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  psql(`delete from public.guide_ai_drafts where topic like 'AI cost test ${run} %';`);
  for (const id of users) await db.auth.admin.deleteUser(id);
}
console.log(failures ? `${failures} failed` : "All AI cost checks passed.");
process.exit(failures ? 1 : 0);
