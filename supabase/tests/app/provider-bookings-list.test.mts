// The provider's bookings list (server/utils/providerBookingList.ts): every
// request and upcoming booking is listed, however many bookings came after
// it, and each tab pages and counts in the database. Recreates the cut-off
// found on 2026-10-10: the list read the 500 most recently made bookings and
// grouped them in code, so an upcoming booking made earlier dropped out.
// Runs against the LOCAL stack, reading as the provider (RLS applies).
// Run: npx tsx supabase/tests/app/provider-bookings-list.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PROVIDER_BOOKINGS_PAGE_SIZE, providerBookingsPage } from "../../../apps/website/server/utils/providerBookingList";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", sql]);

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "" };
const PAST = 1050; // more than the API's 1,000-row limit, and the old 500

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  // Test logins on the local stack only, with a throwaway password.
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string) => {
    const { user } = await must(db.auth.admin.createUser({ email: `blist-${label}-${run}@test.local`, password, email_confirm: true }));
    created.users.push(user.id);
    const client = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, client };
  };
  const owner = await login("provider");
  const customer = await login("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Busy Tours", city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `List ${run}`, slug: `list-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `List ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, city_id: atl.id, kind: "experience", category_id: created.category, area_id: created.area,
    title: `Daily walk ${run}`, description: "A listing made by the bookings list test.", price_cents: 5000, duration_minutes: 60, status: "draft",
  }));
  const session = (await must(db.from("experience_sessions").insert({ listing_id: created.listing, starts_at: new Date(Date.now() + 10 * 864e5).toISOString(), capacity: 500 }).select("id").single())).id;

  // The bookings, written straight to the table with the guards off (local
  // only): first an upcoming booking and a request made 60 days ago, then
  // 1,050 newer bookings that have ended.
  const cols = "id, kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, total_cents, status, starts_at, ends_at, confirmed_at, payout_due_at, respond_by, created_at";
  const row = (id: string, status: string, startsDays: number, createdDays: number, respondBy: string | null = null) => {
    const start = `now() + interval '${startsDays} days'`;
    const confirmed = ["requested", "pending_payment", "expired"].includes(status) ? "null" : `now() - interval '${createdDays} days'`;
    return `('${id}', 'experience', '${created.listing}', '${created.provider}', '${customer.id}', '${session}', 'Sam', 5000, 5000, '${status}', ` +
      `${start}, ${start} + interval '1 hour', ${confirmed}, ${start} + interval '25 hours', ${respondBy ?? "null"}, now() - interval '${createdDays} days')`;
  };
  const upcomingId = randomUUID();
  const requestId = randomUUID();
  const rows = [row(upcomingId, "confirmed", 10, 60), row(requestId, "requested", 12, 59, "now() + interval '1 day'")];
  for (let i = 0; i < PAST; i++) rows.push(row(randomUUID(), "completed", -1 - i / 100, 50 - i / 100));
  // Checkouts never finished: one still open, one that ran out unpaid.
  rows.push(row(randomUUID(), "pending_payment", 11, 1), row(randomUUID(), "expired", 11, 2));
  psql(`set local session_replication_role = replica; insert into public.bookings (${cols}) values ${rows.join(",\n")};`);

  const as = owner.client;
  // 1. The tabs that must never lose a booking.
  const upcoming = await providerBookingsPage(as, created.provider, "upcoming", 1);
  check(upcoming.items.some((b) => b.id === upcomingId), "1a. an upcoming booking made before 1,050 newer ones is in Upcoming");
  check(upcoming.counts.upcoming === 1, `1b. ...and Upcoming counts 1 (got ${upcoming.counts.upcoming})`);
  const requests = await providerBookingsPage(as, created.provider, "requests", 1);
  check(requests.items.some((b) => b.id === requestId) && requests.counts.requests === 1, "1c. an old request is in Requests, counted");

  // 2. Past: counted in full, paged, newest first, no repeats.
  const past1 = await providerBookingsPage(as, created.provider, "past", 1);
  check(past1.total === PAST && past1.counts.past === PAST, `2a. Past counts all ${PAST} (got ${past1.total})`);
  check(past1.items.length === PROVIDER_BOOKINGS_PAGE_SIZE, "2b. ...one page at a time");
  const lastPage = Math.ceil(PAST / PROVIDER_BOOKINGS_PAGE_SIZE);
  const pastLast = await providerBookingsPage(as, created.provider, "past", lastPage);
  check(pastLast.items.length === PAST - (lastPage - 1) * PROVIDER_BOOKINGS_PAGE_SIZE, `2c. the last page (${lastPage}) holds the rest`);
  const past2 = await providerBookingsPage(as, created.provider, "past", 2);
  const starts = [...past1.items, ...past2.items].map((b) => Date.parse(b.starts_at));
  check(starts.every((t, i) => i === 0 || t <= starts[i - 1]!), "2d. ...most recent first, across pages");
  check(new Set([...past1.items, ...past2.items].map((b) => b.id)).size === PROVIDER_BOOKINGS_PAGE_SIZE * 2, "2e. ...with no booking on two pages");
  check(!past1.items.some((b) => b.id === upcomingId || b.id === requestId), "2f. upcoming bookings and requests aren't in Past");
  check(past1.counts.requests + past1.counts.upcoming + past1.counts.past === PAST + 2, "2g. checkouts never finished (open, or expired unpaid) are in no tab");

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
console.log(failures ? `${failures} failed` : "All provider bookings list checks passed.");
process.exit(failures ? 1 : 0);
