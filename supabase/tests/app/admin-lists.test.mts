// The admin's shorter lists (apps/admin/app/utils/adminLists.ts), read as an
// admin against the LOCAL stack: each shows its latest rows and counts all of
// them, and the homepage picker reads every published guide. Recreates the
// cut-offs found on 2026-10-10: failed emails (100), failed job runs (50), a
// listing's bookings (200), rate changes (50) and a guide's AI drafts (10)
// were counted by the rows read, and the picker stopped at the API's 1,000.
// Run: npx tsx supabase/tests/app/admin-lists.test.mts

import { forgetTestAdmins, makeAdmin } from "./_admin.mts";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import {
  FAILED_EMAILS_SHOWN, FAILED_RUNS_SHOWN, GUIDE_DRAFTS_SHOWN, LISTING_BOOKINGS_SHOWN, RATE_CHANGES_SHOWN,
  failedEmails, failedJobRuns, guideDraftLog, listingBookings, publishedGuides, rateChanges,
} from "../../../apps/admin/app/utils/adminLists";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
// The SQL goes on standard input: Linux caps one command-line argument at 128 KB.
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });
const count = (sql: string) => Number(execFileSync("psql", [local.DB_URL!, "-X", "-At", "-f", "-"], { input: sql, encoding: "utf8" }).trim());

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "", city: "", guide: "" };
const jobMark = `admin-lists-${run}`;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string, admin = false) => {
    if (admin) {
      const a = await makeAdmin(local, `lists-${label}-${run}@test.local`);
      created.users.push(a.id);
      return { id: a.id, client: a.client };
    }
    const { user } = await must(db.auth.admin.createUser({
      email: `lists-${label}-${run}@test.local`, password, email_confirm: true,
    }));
    created.users.push(user.id);
    const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, client };
  };
  const admin = await login("admin", true);
  const owner = await login("provider");
  const customer = await login("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Busy Lists", city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Lists ${run}`, slug: `lists-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Lists ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, city_id: atl.id, kind: "experience", category_id: created.category, area_id: created.area,
    title: `Busy walk ${run}`, description: "A listing made by the admin lists test.", price_cents: 5000, duration_minutes: 60, status: "draft",
  }));
  // A market of its own for 1,050 published guides.
  created.city = (await must(db.from("cities").insert({ slug: `lists-${run}`, name: `Lists ${run}`, state: "GA", timezone: "America/New_York" }).select("id").single())).id;

  // Written with the guards off (local only):
  // - 220 bookings on one listing, 210 of them confirmed and upcoming, each
  //   with a failed email;
  // - 60 failed job runs and 60 rate changes;
  // - a guide with 12 AI drafts, and 1,050 published guides.
  created.guide = randomUUID();
  psql(`set local session_replication_role = replica;
    with s as (insert into public.experience_sessions (listing_id, starts_at, capacity) values ('${created.listing}', now() + interval '30 days', 500) returning id)
    insert into public.bookings (kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, total_cents, starts_at, ends_at, status, confirmed_at, payout_due_at)
    select 'experience', '${created.listing}', '${created.provider}', '${customer.id}', (select id from s), 'Sam', 5000, 5000,
           now() + (case when g <= 210 then 30 else -30 end) * interval '1 day' + g * interval '1 minute',
           now() + (case when g <= 210 then 30 else -30 end) * interval '1 day' + g * interval '1 minute' + interval '1 hour',
           case when g <= 210 then 'confirmed' else 'completed' end, now() - interval '40 days', now() + interval '31 days'
    from generate_series(1, 220) g;
    insert into public.booking_emails (booking_id, kind, status, attempts, last_error)
    select id, 'customer_booking_confirmed', 'failed', 6, 'Resend 500: test' from public.bookings where listing_id = '${created.listing}';
    insert into public.job_runs (job, started_at, finished_at, checked, failed, failures)
    select '${jobMark}', now() - interval '1 hour', now() - g * interval '1 minute', 1, 1, array['x: failed'] from generate_series(1, 60) g;
    insert into public.commission_rate_changes (kind, old_rate_bps, new_rate_bps, changed_at)
    select 'service', 1200, 1200 + g, now() - g * interval '1 second' from generate_series(1, 60) g;
    insert into public.guides (id, market_id, slug, draft_title) values ('${created.guide}', '${created.city}', 'lists-draft', 'Draft');
    insert into public.guide_ai_drafts (guide_id, topic, model, cost_usd)
    select '${created.guide}', 'Lists ${run} ' || g, 'test-model', 0.01 from generate_series(1, 12) g;
    insert into public.guides (market_id, slug, status, draft_title, title, teaser, body, cover_photo_id, published_at, content_updated_at)
    select '${created.city}', 'lists-guide-' || g, 'published', 'Guide ' || g, 'Guide ' || g, 'A teaser', '{"blocks": []}', gen_random_uuid(), now(), now() - g * interval '1 minute'
    from generate_series(1, 1050) g;`);

  const allFailedEmails = count("select count(*) from public.booking_emails where status = 'failed'");
  const emails = await failedEmails(admin.client);
  check(emails.items.length === FAILED_EMAILS_SHOWN && emails.total === allFailedEmails,
    `1. failed emails: the latest ${FAILED_EMAILS_SHOWN} shown, all ${allFailedEmails} counted (got ${emails.total})`);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const allFailedRuns = count(`select count(*) from public.job_runs where finished_at >= '${since}' and (failed > 0 or error is not null or more_waiting)`);
  const runs = await failedJobRuns(admin.client, since);
  check(runs.items.length === FAILED_RUNS_SHOWN && runs.total === allFailedRuns,
    `2. failed job runs: the latest ${FAILED_RUNS_SHOWN} shown, all ${allFailedRuns} counted (got ${runs.total})`);
  const bookings = await listingBookings(admin.client, created.listing);
  check(bookings.items.length === LISTING_BOOKINGS_SHOWN && bookings.total === 220,
    `3a. a listing's bookings: ${LISTING_BOOKINGS_SHOWN} shown, all 220 counted (got ${bookings.total})`);
  check(bookings.upcoming === 210, `3b. ...and all 210 confirmed or waiting counted (got ${bookings.upcoming})`);
  const allChanges = count("select count(*) from public.commission_rate_changes");
  const changes = await rateChanges(admin.client);
  check(changes.items.length === RATE_CHANGES_SHOWN && changes.total === allChanges,
    `4. rate changes: the latest ${RATE_CHANGES_SHOWN} shown, all ${allChanges} counted (got ${changes.total})`);
  const drafts = await guideDraftLog(admin.client, created.guide);
  check(drafts.items.length === GUIDE_DRAFTS_SHOWN && drafts.total === 12,
    `5. a guide's AI drafts: the latest ${GUIDE_DRAFTS_SHOWN} shown, all 12 counted (got ${drafts.total})`);
  const allPublished = count("select count(*) from public.guides where status = 'published'");
  const guides = await publishedGuides(admin.client);
  check(guides.length === allPublished, `6. the homepage picker reads every published guide (${allPublished}; got ${guides.length})`);
  check(new Set(guides.map((g) => g.id)).size === guides.length, "6b. ...each once");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  forgetTestAdmins();
  psql(`set local session_replication_role = replica;
    delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id = '${created.listing}');
    delete from public.bookings where listing_id = '${created.listing}';
    delete from public.experience_sessions where listing_id = '${created.listing}';
    delete from public.listings where id = '${created.listing}';
    delete from public.job_runs where job = '${jobMark}';
    delete from public.commission_rate_changes where kind = 'service' and old_rate_bps = 1200 and new_rate_bps between 1201 and 1260;
    delete from public.guide_ai_drafts where guide_id = '${created.guide}';
    delete from public.guides where market_id = '${created.city}';
    delete from public.cities where id = '${created.city}';`);
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All admin list checks passed.");
process.exit(failures ? 1 : 0);
