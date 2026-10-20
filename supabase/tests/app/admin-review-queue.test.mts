// The admin's review queue (apps/admin/app/utils/reviewQueue.ts), read as
// an admin against the LOCAL stack. Recreates the cut-off found on
// 2026-10-10: the queue read every waiting Experience and its count was the
// number of rows read, so past the API's 1,000 rows the count stopped at
// 1,000 and the newest submissions were missing.
// Run: npx tsx supabase/tests/app/admin-review-queue.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { REVIEW_QUEUE_PAGE_SIZE, reviewQueuePage } from "../../../apps/admin/app/utils/reviewQueue";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
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
const created = { users: [] as string[], provider: "", category: "", area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string, admin = false) => {
    if (admin) {
      const a = await makeAdmin(local, `queue-${label}-${run}@test.local`);
      created.users.push(a.id);
      return { id: a.id, client: a.client };
    }
    const { user } = await must(db.auth.admin.createUser({
      email: `queue-${label}-${run}@test.local`, password, email_confirm: true,
    }));
    created.users.push(user.id);
    const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, client };
  };
  const admin = await login("admin", true);
  const owner = await login("provider");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Queued Tours", city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Queue ${run}`, slug: `queue-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Queue ${run}` }).select("id").single())).id;

  // 1,050 Experiences sent for review, a minute apart; the newest last.
  // Written as drafts with what review needs (listing_readiness: a photo
  // and the meeting address), then sent for review with the triggers on.
  const newest = randomUUID();
  psql(`set local session_replication_role = replica;
    insert into public.listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, submitted_at)
    select 'queue-${run}-' || g, '${created.provider}', 'experience', '${created.category}', '${atl.id}', 'Queued walk ' || g, 'A listing made by the review queue test.',
           5000, 60, '${created.area}', now() - interval '2 days' + g * interval '1 minute'
    from generate_series(1, 1049) g;
    insert into public.listings (id, slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, submitted_at)
    values ('${newest}', 'queue-${run}-newest', '${created.provider}', 'experience', '${created.category}', '${atl.id}', 'Newest walk', 'A listing made by the review queue test.',
            5000, 60, '${created.area}', now());
    insert into public.listing_photos (listing_id, storage_path, position, alt_text)
    select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A test photo' from public.listings where provider_id = '${created.provider}';
    insert into public.listing_addresses (listing_id, line1, city, state, postal_code)
    select id, '1 Test Street', 'Atlanta', 'GA', '30312' from public.listings where provider_id = '${created.provider}';`);
  psql(`update public.listings set status = 'submitted' where provider_id = '${created.provider}';`);
  const waiting = count("select count(*) from public.listings where kind = 'experience' and status = 'submitted'");

  const page1 = await reviewQueuePage(admin.client);
  check(page1.total === waiting, `1a. the queue counts every waiting Experience (${waiting}; got ${page1.total})`);
  check(page1.items.length === REVIEW_QUEUE_PAGE_SIZE, `1b. ...${REVIEW_QUEUE_PAGE_SIZE} a page`);
  const last = Math.ceil(waiting / REVIEW_QUEUE_PAGE_SIZE);
  const lastPage = await reviewQueuePage(admin.client, last);
  check(lastPage.items.at(-1)?.id === newest, `1c. the newest submission is last, on page ${last}`);
  const times = page1.items.map((r) => Date.parse(r.submitted_at ?? "1970-01-01"));
  check(times.every((t, i) => i === 0 || t >= times[i - 1]!), "1d. oldest first");
  const page2 = await reviewQueuePage(admin.client, 2);
  check(new Set([...page1.items, ...page2.items].map((r) => r.id)).size === REVIEW_QUEUE_PAGE_SIZE * 2, "1e. no listing on two pages");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  forgetTestAdmins();
  if (created.provider) psql(`set local session_replication_role = replica;
    delete from public.listing_photos where listing_id in (select id from public.listings where provider_id = '${created.provider}');
    delete from public.listing_addresses where listing_id in (select id from public.listings where provider_id = '${created.provider}');
    delete from public.listings where provider_id = '${created.provider}';`);
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All review queue checks passed.");
process.exit(failures ? 1 : 0);
