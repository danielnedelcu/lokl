// Timed jobs working in batches (server/utils/bookingJobs.ts and the email
// outbox), against the LOCAL stack. Recreates what the truncation sweep found
// on 2026-10-10:
// - batches weren't ordered, so the most overdue booking could wait while
//   newer ones went first, and a run didn't say when more were waiting;
// - withdraw-unavailable read 500 open bookings and chose in code, so one
//   behind 500 available ones was never withdrawn;
// - pay-out read 200 due bookings and dropped the unpayable ones in code, so
//   200 of those (cancelled and refunded) stopped every payout behind them.
// None of these paths call Stripe; the stub fails the test if one does.
// Run: npx tsx supabase/tests/app/booking-job-batches.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { expireRequests, payOut, withdrawUnavailable } from "../../../apps/website/server/utils/bookingJobs";
import { sendBookingEmails } from "../../../apps/website/server/utils/bookingEmails";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
// The SQL goes on standard input: Linux caps one command-line argument at 128 KB.
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });
const value = (sql: string) => execFileSync("psql", [local.DB_URL!, "-X", "-At", "-f", "-"], { input: sql, encoding: "utf8" }).trim();
const noStripe = new Proxy({}, { get: () => { throw new Error("Stripe was called"); } }) as unknown as Stripe;

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], category: "", area: "" };
const status = (id: string) => value(`select status from public.bookings where id = '${id}'`);

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `batches-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return u.id;
  };
  const customer = await user("customer");
  const provider = async (label: string, state = "active") => {
    const id = (await must(db.from("providers").insert({ owner_id: await user(label), display_name: `Batches ${label}`, city_id: atl.id }).select("id").single())).id;
    if (state !== "active") psql(`set local session_replication_role = replica; update public.providers set status = '${state}' where id = '${id}';`);
    created.providers.push(id);
    return id as string;
  };
  const open = await provider("open");
  const suspended = await provider("suspended", "suspended");
  created.category = (await must(db.from("categories").insert({ kind: "service", name: `Batches ${run}`, slug: `batches-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Batches ${run}` }).select("id").single())).id;
  const listing = async (providerId: string) => {
    const id = randomUUID();
    created.listings.push(id);
    psql(`set local session_replication_role = replica;
      insert into public.listings (id, slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, location_mode, status, booking_mode)
      values ('${id}', 'batches-${id}', '${providerId}', 'service', '${created.category}', '${atl.id}', 'Batches cut', 'A listing made by the job batches test.', 5000, 60, '${created.area}', 'provider_location', 'live', 'approve');`);
    return id;
  };
  const live = await listing(open);
  const down = await listing(suspended);

  // Bookings written straight to the tables with the guards off (local
  // only), each with its finances row. `order` puts the one that matters last.
  const insert = (rows: { id: string; listing: string; provider: string; status: string; extra?: Record<string, string> }[]) => {
    const cols = ["id", "kind", "listing_id", "provider_id", "customer_id", "customer_name", "unit_price_cents", "total_cents", "preferred_times", "status"];
    const extraCols = [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))];
    const values = rows.map((r) => `('${r.id}', 'service', '${r.listing}', '${r.provider}', '${customer}', 'Sam', 5000, 5000, array[now() + interval '20 days'], '${r.status}'` +
      extraCols.map((c) => `, ${r.extra?.[c] ?? "default"}`).join("") + ")");
    psql(`set local session_replication_role = replica;
      insert into public.bookings (${[...cols, ...extraCols].join(", ")}) values ${values.join(",\n")};
      insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents)
      select id, 1200, 600, 4400 from public.bookings where id in (${rows.map((r) => `'${r.id}'`).join(",")});`);
  };

  // 1. expire-requests: 201 overdue requests; the most overdue written last.
  const mostOverdue = randomUUID();
  insert([
    ...Array.from({ length: 200 }, (_, i) => ({ id: randomUUID(), listing: live, provider: open, status: "requested", extra: { respond_by: `now() - interval '${i + 1} minutes'` } })),
    { id: mostOverdue, listing: live, provider: open, status: "requested", extra: { respond_by: "now() - interval '1 day'" } },
  ]);
  const first = await expireRequests(db, noStripe);
  check(status(mostOverdue) === "expired", "1a. the most overdue request expires in the first run, though it was written last");
  check((first as { moreWaiting?: boolean }).moreWaiting === true, "1b. ...and the run says more are waiting (its batch was full)");
  const second = await expireRequests(db, noStripe);
  check((second as { moreWaiting?: boolean }).moreWaiting === false, "1c. the next run clears the rest and says none are waiting");
  check(first.failed.length === 0 && second.failed.length === 0, "1d. no failures (and no Stripe calls)");

  // 2. withdraw-unavailable: 501 open requests on a live listing, then one
  //    on a suspended provider's listing.
  const unavailable = randomUUID();
  insert([
    ...Array.from({ length: 501 }, () => ({ id: randomUUID(), listing: live, provider: open, status: "requested", extra: { respond_by: "now() + interval '2 days'" } })),
    { id: unavailable, listing: down, provider: suspended, status: "requested", extra: { respond_by: "now() + interval '2 days'" } },
  ]);
  const withdrawn = await withdrawUnavailable(db, noStripe);
  check(status(unavailable) === "declined", "2. a request on a suspended provider's listing is withdrawn, behind 501 that stay open");
  check(withdrawn.failed.length === 0, "2b. ...with no failures");

  // 3. pay-out: 201 cancelled and refunded bookings past their payout time
  //    (never paid out), then a completed one with a problem reported, which
  //    must be held for the admin.
  const payable = randomUUID();
  const due = { payout_due_at: "now() - interval '1 hour'", confirmed_at: "now() - interval '10 days'", starts_at: "now() - interval '3 days'", ends_at: "now() - interval '3 days' + interval '1 hour'" };
  insert([
    ...Array.from({ length: 201 }, () => ({ id: randomUUID(), listing: live, provider: open, status: "cancelled",
      extra: { ...due, cancelled_by: "'provider'", refunded_cents: "5000" } })),
    { id: payable, listing: live, provider: open, status: "completed", extra: { ...due, problem_reported_at: "now() - interval '2 days'" } },
  ]);
  const paid = await payOut(db, noStripe);
  check(value(`select payout_hold from public.booking_finances where booking_id = '${payable}'`) === "problem_reported",
    "3. a due payout behind 201 unpayable ones is handled (held for the reported problem)");
  check(paid.failed.length === 0, "3b. ...with no failures");

  // 4. The email outbox: a batch of 2 with 3 due says more are waiting.
  const mailFor = randomUUID();
  insert([{ id: mailFor, listing: live, provider: open, status: "confirmed", extra: due }]);
  psql(`insert into public.booking_emails (booking_id, kind) values
    ('${mailFor}', 'customer_booking_confirmed'), ('${mailFor}', 'customer_booking_cancelled'), ('${mailFor}', 'customer_problem_received');`);
  const settings = { mode: "off" as const, allowlist: [], from: "lokl <test@test.local>", replyTo: "", siteUrl: "http://localhost:3100" };
  const sent = await sendBookingEmails(db, null, settings, { bookingId: mailFor, limit: 2 });
  check((sent as { more?: boolean }).more === true, "4a. the email sender says more are waiting when its batch is full");
  const rest = await sendBookingEmails(db, null, settings, { bookingId: mailFor, limit: 2 });
  check((rest as { more?: boolean }).more === false && rest.skipped.length === 1, "4b. ...and not once it's done");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listings.length) {
    const ids = created.listings.map((id) => `'${id}'`).join(",");
    psql(`set local session_replication_role = replica;
      delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_events where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.notifications where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.bookings where listing_id in (${ids});
      delete from public.listings where id in (${ids});`);
  }
  for (const id of created.providers) await db.from("providers").delete().eq("id", id);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All job batch checks passed.");
process.exit(failures ? 1 : 0);
