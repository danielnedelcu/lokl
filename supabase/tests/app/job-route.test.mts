// The job route (apps/website/server/api/jobs/[name].post.ts) and the
// scheduler's safeguards (decided 2026-10-21), against the test website:
// only the secret opens it; one run of a job at a time (a second call is
// skipped); a run the host stopped is recorded as killed; every run updates
// job_status, and job_runs keeps only the runs that did something; and no
// API request can reach pg_net or pg_cron.
// Run: npx tsx supabase/tests/app/job-route.test.mts (the website on WEBSITE_URL with NUXT_JOB_SECRET, as the full checks start it)

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const WEBSITE_URL = process.env.WEBSITE_URL ?? "http://localhost:3100";
const SECRET = process.env.NUXT_JOB_SECRET ?? "";
if (!SECRET) {
  console.error("Refusing to run: needs NUXT_JOB_SECRET, the test website's job secret (the full checks set it).");
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sql = (text: string) => execFileSync("psql", [local.DB_URL!, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8" }).trim();
const call = (job: string, secret: string | null = SECRET, method = "POST") =>
  fetch(`${WEBSITE_URL}/api/jobs/${job}`, { method, headers: secret === null ? {} : { "x-job-secret": secret } });
const status = (job: string) => sql(`select coalesce(last_outcome, '-') || '|' || skipped_overlaps || '|' || killed_runs || '|' || coalesce(to_char(last_success_at, 'YYYY'), '-') from public.job_status where job = '${job}'`);
const runs = (job: string) => Number(sql(`select count(*) from public.job_runs where job = '${job}'`));
const run = randomBytes(4).toString("hex");
const created = { users: [] as string[], provider: "", request: "" };

try {
  // 1. The door.
  check((await call("admin-requests", "not-the-secret")).status === 401, "1a. a wrong secret is refused");
  check((await call("admin-requests", null)).status === 401, "1b. ...and no secret");
  check((await call("no-such-job")).status === 404, "1c. an unknown job is refused");
  check([404, 405].includes((await call("admin-requests", SECRET, "GET")).status), "1d. only POST runs a job");

  // 2. A quiet run: job_status only. A run that did something: job_runs too.
  sql(`delete from public.job_leases where job in ('admin-requests', 'held-photos', 'refresh-open-days')`);
  const before = runs("admin-requests");
  const quiet = await call("admin-requests");
  check(quiet.ok && status("admin-requests").startsWith("ok|"), `2a. a run with nothing to do succeeds, recorded in job_status (${status("admin-requests")})`);
  check(runs("admin-requests") === before, "2b. ...and isn't added to job_runs");
  // A support request the owner never decided, 8 days old (backdated with triggers off).
  await makeAdmin(local, `jobs-owner-${run}@test.local`).then((a) => created.users.push(a.id));
  const sup = await makeAdmin(local, `jobs-support-${run}@test.local`, { role: "support" });
  created.users.push(sup.id);
  const { user } = await must(db.auth.admin.createUser({ email: `jobs-provider-${run}@test.local`, email_confirm: true }));
  created.users.push(user!.id);
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  created.provider = (await must(db.from("providers").insert({ owner_id: user!.id, display_name: `Jobs ${run}`, city_id: atl.id }).select("id").single())).id;
  created.request = await must(sup.client.rpc("admin_request_create", {
    p_kind: "suspend_provider", p_booking_id: null as unknown as string, p_provider_id: created.provider, p_reason: "Three no-shows this month.",
  })) as string;
  sql(`set session_replication_role = replica; update public.admin_requests set created_at = now() - interval '8 days' where id = '${created.request}';`);
  const busy = await (await call("admin-requests")).json() as { done: string[] };
  check(busy.done.some((l) => l.startsWith(created.request)), "2c. the job expires the request (it says which)");
  check(runs("admin-requests") === before + 1, "2d. ...and that run is in job_runs");

  // 3. One run at a time: a second call while a run holds the job is skipped.
  const lease = sql(`select public.job_start('held-photos')`);
  const skipped = await (await call("held-photos")).json() as { skipped?: string };
  check(skipped.skipped === "already running", "3a. a call while another run holds the job is skipped");
  check(status("held-photos").split("|")[1] === "1", "3b. ...counted as skipped, not failed");
  sql(`select public.job_finish('held-photos', '${lease}', true)`);
  check((await call("held-photos")).ok, "3c. once the run ends, the next call runs");

  // 4. A run the host stopped: its lease outlived it; the next run takes over and records it.
  sql(`insert into public.job_leases (job, run_id, started_at, expires_at)
       values ('refresh-open-days', gen_random_uuid(), now() - interval '6 minutes', now() - interval '1 minute')
       on conflict (job) do update set started_at = excluded.started_at, expires_at = excluded.expires_at`);
  const killedBefore = Number(status("refresh-open-days").split("|")[2]);
  check((await call("refresh-open-days")).ok, "4a. the next run takes over a lease left by a run that died");
  check(Number(status("refresh-open-days").split("|")[2]) === killedBefore + 1, "4b. ...counting the dead run as killed");
  check(Number(sql(`select count(*) from public.job_runs where job = 'refresh-open-days' and error like 'This run started and never finished%'`)) >= 1,
    "4c. ...with a record of it in job_runs");

  // 5. No API request reaches pg_net or pg_cron, whatever their grants (the API serves public, graphql_public and private only).
  for (const [schema, fn] of [["net", "http_get"], ["cron", "schedule"]] as const) {
    const res = await fetch(`${local.API_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: local.SERVICE_ROLE_KEY!, Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, "Content-Profile": schema, "Content-Type": "application/json" },
      body: "{}",
    });
    check(res.status === 406, `5. the API refuses the ${schema} schema, even with the server key (${res.status})`);
  }
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message.split("\n")[0]}`);
} finally {
  forgetTestAdmins();
  sql(`set session_replication_role = replica;
    delete from public.admin_notifications where admin_request_id = ${created.request ? `'${created.request}'` : "null"};
    delete from public.admin_emails where admin_action_id in (select id from public.admin_actions where request_id = ${created.request ? `'${created.request}'` : "null"});
    delete from public.admin_actions where request_id = ${created.request ? `'${created.request}'` : "null"};
    delete from public.admin_requests where id = ${created.request ? `'${created.request}'` : "null"};
    delete from public.job_leases where job in ('held-photos', 'refresh-open-days');
    ${created.provider ? `delete from public.providers where id = '${created.provider}';` : ""}`);
  for (const id of created.users) await db.auth.admin.deleteUser(id).catch(() => {});
}
console.log(failures ? `${failures} failed` : "All job route checks passed.");
process.exit(failures ? 1 : 0);
