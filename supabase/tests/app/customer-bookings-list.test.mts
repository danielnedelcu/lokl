// The customer's "My bookings" list (server/utils/customerBookingList.ts),
// read as the customer (RLS) against the LOCAL stack. Recreates the cut-off
// found on 2026-10-10: the list read every booking at once, so past the
// API's 1,000 rows the oldest-made bookings, an upcoming one among them,
// were missing.
// Run: npx tsx supabase/tests/app/customer-bookings-list.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { CUSTOMER_BOOKINGS_PAGE_SIZE, customerBookingsPage } from "../../../apps/website/server/utils/customerBookingList";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
// The SQL goes on standard input: Linux caps one command-line argument at 128 KB.
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "" };
const PAST = 1050;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string) => {
    const { user } = await must(db.auth.admin.createUser({ email: `mine-${label}-${run}@test.local`, password, email_confirm: true }));
    created.users.push(user.id);
    const client = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, client };
  };
  const owner = await login("provider");
  const customer = await login("customer");
  const stranger = await login("stranger");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Mine Tours", city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Mine ${run}`, slug: `mine-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Mine ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, city_id: atl.id, kind: "experience", category_id: created.category, area_id: created.area,
    title: `Mine walk ${run}`, description: "A listing made by the my bookings test.", price_cents: 5000, duration_minutes: 60, status: "draft",
  }));

  // Written with the guards off (local only): an upcoming booking made 90
  // days ago, then 1,050 since that have ended, the newest named "Latest".
  const upcoming = randomUUID();
  const row = (id: string, status: string, startDays: number, madeDays: number, name = "Sam") =>
    `('${id}', 'experience', '${created.listing}', '${created.provider}', '${customer.id}', (select id from s), '${name}', 5000, 5000, ` +
    `now() + interval '${startDays} days', now() + interval '${startDays} days' + interval '1 hour', '${status}', now() - interval '${madeDays} days')`;
  const rows = [row(upcoming, "confirmed", 10, 90), ...Array.from({ length: PAST }, (_, i) => row(randomUUID(), "completed", -1 - i / 100, 80 - i / 100, i === PAST - 1 ? "Latest" : "Sam"))];
  psql(`set local session_replication_role = replica;
    with s as (insert into public.experience_sessions (listing_id, starts_at, capacity) values ('${created.listing}', now() + interval '10 days', 500) returning id)
    insert into public.bookings (id, kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, total_cents, starts_at, ends_at, status, created_at)
    values ${rows.join(",\n")};`);

  const as = customer.client;
  const up = await customerBookingsPage(as, customer.id, "upcoming");
  check(up.items.some((b) => b.id === upcoming) && up.total === 1, "1. an upcoming booking made before 1,050 others is in Upcoming");
  const past1 = await customerBookingsPage(as, customer.id, "past");
  check(past1.total === PAST, `2a. Past counts all ${PAST} (got ${past1.total})`);
  check(past1.items.length === CUSTOMER_BOOKINGS_PAGE_SIZE, `2b. ...${CUSTOMER_BOOKINGS_PAGE_SIZE} a page`);
  const last = Math.ceil(PAST / CUSTOMER_BOOKINGS_PAGE_SIZE);
  check((await customerBookingsPage(as, customer.id, "past", last)).items.length === PAST - (last - 1) * CUSTOMER_BOOKINGS_PAGE_SIZE,
    `2c. ...and the last page (${last}) holds the rest`);
  const past2 = await customerBookingsPage(as, customer.id, "past", 2);
  check(new Set([...past1.items, ...past2.items].map((b) => b.id)).size === CUSTOMER_BOOKINGS_PAGE_SIZE * 2, "2d. no booking on two pages");
  const latest = await customerBookingsPage(as, customer.id, "latest");
  check(latest.items.length === 1 && latest.items[0].customer_name === "Latest", "3. latest is the one most recently made");
  const other = await customerBookingsPage(stranger.client, customer.id, "past");
  check(other.total === 0, "4. another signed-in person reads none of them");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listing) {
    psql(`set local session_replication_role = replica;
      delete from public.bookings where listing_id = '${created.listing}';
      delete from public.experience_sessions where listing_id = '${created.listing}';
      delete from public.listings where id = '${created.listing}';`);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All my bookings checks passed.");
process.exit(failures ? 1 : 0);
