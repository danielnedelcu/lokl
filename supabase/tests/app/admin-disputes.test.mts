// The admin's Disputes & refunds page (apps/admin/app/utils/disputes.ts),
// read as an admin against the LOCAL stack. Recreates the cut-off found on
// 2026-10-10: the page read the latest 200 disputes and split them into open
// and closed in code, so an open dispute older than those (with an evidence
// deadline) disappeared; refunds stopped at 100 without saying so.
// Run: npx tsx supabase/tests/app/admin-disputes.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DISPUTES_PAGE_SIZE, loadDisputes } from "../../../apps/admin/app/utils/disputes";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
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
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  // Test logins on the local stack only, with a throwaway password. The
  // admin is only an admin (no business).
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string, admin = false) => {
    const { user } = await must(db.auth.admin.createUser({
      email: `disputes-${label}-${run}@test.local`, password, email_confirm: true, ...(admin ? { app_metadata: { role: "admin" } } : {}),
    }));
    created.users.push(user.id);
    const client = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, client };
  };
  const admin = await login("admin", true);
  const owner = await login("provider");
  const customer = await login("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Disputed Tours", city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Disputes ${run}`, slug: `disputes-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Disputes ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, city_id: atl.id, kind: "experience", category_id: created.category, area_id: created.area,
    title: `Disputed walk ${run}`, description: "A listing made by the disputes test.", price_cents: 5000, duration_minutes: 60, status: "draft",
  }));

  // Written with the guards off (local only): an open dispute from 60 days
  // ago; then 210 closed disputes since; then 106 refunds, the oldest first.
  const oldOpen = randomUUID();
  const oldRefund = randomUUID();
  const booking = (id: string, extra: string) =>
    `('${id}', 'experience', '${created.listing}', '${created.provider}', '${customer.id}', (select id from s), 'Sam', 5000, 5000, now() - interval '70 days', now() - interval '69 days', ${extra})`;
  const closedIds = Array.from({ length: 210 }, () => randomUUID());
  const refundIds = Array.from({ length: 105 }, () => randomUUID());
  psql(`set local session_replication_role = replica;
    with s as (insert into public.experience_sessions (listing_id, starts_at, capacity) values ('${created.listing}', now() - interval '70 days', 500) returning id)
    insert into public.bookings (id, kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, total_cents, starts_at, ends_at, status, refunded_cents, refunded_at, cancelled_by)
    values ${[booking(oldOpen, "'completed', 0, null, null"),
              ...closedIds.map((id) => booking(id, "'completed', 0, null, null")),
              booking(oldRefund, "'cancelled', 5000, now() - interval '50 days', 'customer'"),
              ...refundIds.map((id, i) => booking(id, `'cancelled', 5000, now() - interval '${i} hours', 'provider'`))].join(",\n")};
    insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents, stripe_dispute_id, disputed_at, dispute_closed_at, dispute_outcome, dispute_evidence_due_by)
    values ('${oldOpen}', 2000, 1000, 4000, 'dp_old_${run}', now() - interval '60 days', null, null, now() + interval '5 days'),
      ${closedIds.map((id, i) => `('${id}', 2000, 1000, 4000, 'dp_${i}_${run}', now() - interval '${i} hours', now() - interval '${i} hours' + interval '1 minute', 'won', null)`).join(",\n")};`);

  const page1 = await loadDisputes(admin.client);
  check(page1.open.some((d) => d.id === oldOpen), "1a. an open dispute older than 210 newer closed ones is listed as open");
  check(page1.open.every((d) => !d.dispute_closed_at), "1b. ...and only open ones are");
  const allClosed = count("select count(*) from public.booking_finances where disputed_at is not null and dispute_closed_at is not null");
  check(page1.closed.total === allClosed, `2a. closed disputes are counted in full (${allClosed}; got ${page1.closed.total})`);
  check(page1.closed.items.length === DISPUTES_PAGE_SIZE, `2b. ...${DISPUTES_PAGE_SIZE} a page`);
  const lastClosed = Math.ceil(allClosed / DISPUTES_PAGE_SIZE);
  check((await loadDisputes(admin.client, { closed: lastClosed })).closed.items.length === allClosed - (lastClosed - 1) * DISPUTES_PAGE_SIZE,
    `2c. ...and the last page (${lastClosed}) holds the rest`);
  const allRefunds = count("select count(*) from public.bookings where refunded_cents > 0");
  check(page1.refunds.total === allRefunds, `3a. refunds are counted in full (${allRefunds}; got ${page1.refunds.total})`);
  const lastRefunds = Math.ceil(allRefunds / DISPUTES_PAGE_SIZE);
  check((await loadDisputes(admin.client, { refunds: lastRefunds })).refunds.items.some((r) => r.id === oldRefund),
    "3b. the oldest refund is on the last page");
  const second = await loadDisputes(admin.client, { closed: 2, refunds: 2 });
  check(new Set([...page1.closed.items, ...second.closed.items].map((d) => d.id)).size === DISPUTES_PAGE_SIZE * 2, "4. no dispute on two pages");

  // Someone who isn't an admin sees none of it (the read rules).
  const notAdmin = await loadDisputes(customer.client);
  check(notAdmin.open.length === 0 && notAdmin.closed.total === 0, "5. a customer sees no disputes");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listing) {
    psql(`set local session_replication_role = replica;
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id = '${created.listing}');
      delete from public.bookings where listing_id = '${created.listing}';
      delete from public.experience_sessions where listing_id = '${created.listing}';
      delete from public.listings where id = '${created.listing}';`);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All disputes page checks passed.");
process.exit(failures ? 1 : 0);
