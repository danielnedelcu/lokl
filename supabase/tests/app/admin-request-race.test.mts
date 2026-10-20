// The last race in step 5b (admin roles; migration admin_requests): an
// approved refund's record arriving while the support member who asked
// withdraws the request. Two real database sessions, on the LOCAL stack:
// A withdraws the request and holds its row for a few seconds; B records
// the refund Stripe has already made (finishing, as a lost reply would),
// approving that request. B must wait for A, then write the record anyway:
// the request stays withdrawn and its id stays on the admin action. A
// check-then-close would refuse here, after Stripe had refunded.
// Run: npx tsx supabase/tests/app/admin-request-race.test.mts

import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const dbUrl = local.DB_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(dbUrl)) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const sql = (text: string) => execFileSync("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8" }).trim();
/** A psql session in the background: its output, errors and how long it took. */
function session(script: string): Promise<{ out: string; err: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => resolve({ out: out.trim(), err: err.trim(), ms: Date.now() - started }));
    p.stdin.end(script);
  });
}

const run = randomBytes(4).toString("hex");
const id = { owner: randomUUID(), sup: randomUUID(), powner: randomUUID(), cust: randomUUID(), supSession: randomUUID() };
const claims = (sub: string, session: string) => JSON.stringify({ sub, role: "authenticated", aal: "aal2", session_id: session });
let booking = "";
let request = "";

try {
  // Fixtures, committed (the two sessions must see them). Test logins only.
  const out = sql(`
    insert into auth.users (id, email, aud, role, instance_id) values
      ('${id.owner}', 'race-owner-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      ('${id.sup}', 'race-support-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      ('${id.powner}', 'race-provider-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      ('${id.cust}', 'race-customer-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
    insert into public.admin_members (user_id, role, status, joined_at) values
      ('${id.owner}', 'owner', 'active', now()), ('${id.sup}', 'support', 'active', now());
    insert into auth.sessions (id, user_id, aal, created_at, updated_at) values ('${id.supSession}', '${id.sup}', 'aal2', now(), now());
    with c as (select id from public.cities where slug = 'atlanta'),
         p as (insert into public.providers (owner_id, display_name, city_id) select '${id.powner}', 'Race Tours ${run}', c.id from c returning id),
         k as (insert into public.categories (kind, name, slug) values ('experience', 'Race ${run}', 'race-${run}') returning id),
         a as (insert into public.service_areas (city_id, kind, name) select c.id, 'neighborhood', 'Race Ward ${run}' from c returning id)
    insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
    select p.id, 'experience', k.id, c.id, 'Race crawl ${run}', 'Four taquerias on the BeltLine, with stories.', 6500, 60, a.id, 'submitted'
      from p, k, a, c;
    insert into public.listing_photos (listing_id, storage_path, position, alt_text)
    select l.id, l.provider_id || '/' || l.id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from public.listings l where l.title = 'Race crawl ${run}';
    update public.listings set status = 'live', published_at = now() where title = 'Race crawl ${run}';
    insert into public.experience_sessions (listing_id, starts_at, capacity)
    select id, now() + interval '7 days', 10 from public.listings where title = 'Race crawl ${run}';
    begin;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    create temp table race_booking on commit drop as
      select (public.reserve_experience_booking(s.id, '${id.cust}', 3::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id as id
        from public.experience_sessions s join public.listings l on l.id = s.listing_id where l.title = 'Race crawl ${run}';
    update public.bookings set status = 'confirmed', status_changed_by = 'stripe' where id = (select id from race_booking);
    select id from race_booking;
    commit;`);
  booking = out.split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l)).at(-1) ?? "";
  check(!!booking, "0a. a paid $195 booking");
  request = sql(`
    begin;
    select set_config('request.jwt.claims', '${claims(id.sup, id.supSession)}', true);
    set local role authenticated;
    select public.admin_request_create('refund', '${booking}', null, 'Race refund, customer sick');
    commit;`).split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l)).at(-1) ?? "";
  check(!!request, "0b. support asks the owner for the refund");

  // A: the withdrawal, holding the request's row.
  const a = session(`
    begin;
    select set_config('request.jwt.claims', '${claims(id.sup, id.supSession)}', true);
    set local role authenticated;
    select public.admin_request_withdraw('${request}');
    select pg_sleep(3);
    commit;`);
  await new Promise((r) => setTimeout(r, 1000));
  // B: the refund's record, finished from Stripe (no admin session), approving the request.
  const b = session(`
    begin;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select set_config('request.headers', '{"x-lokl-finishing":"stripe"}', true);
    set local role service_role;
    select public.admin_cancel_booking('${booking}', '${id.owner}', 'Race refund, customer sick', 'confirmed', false, 19500, now(), null, null, '${request}');
    commit;`);
  const [ra, rb] = await Promise.all([a, b]);
  check(ra.out.includes("withdrawn") && !ra.err.includes("ERROR"), "1a. A withdraws the request");
  check(rb.ms >= 1500, `1b. B waited for A's hold on the request (${rb.ms} ms)`);
  check(rb.out.split("\n").includes("cancelled") && !rb.err.includes("ERROR"), `1c. B records the refund anyway${rb.err ? ` (${rb.err.split("\n")[0]})` : ""}`);
  const after = sql(`
    select r.status || '/' || coalesce((select a.request_id::text from public.admin_actions a where a.action = 'cancel_booking' and a.target_id = '${booking}'), '-')
           || '/' || (select b.status from public.bookings b where b.id = '${booking}')
      from public.admin_requests r where r.id = '${request}';`);
  check(after === `withdrawn/${request}/cancelled`, `1d. the request stays withdrawn, its id on the cancellation, the booking cancelled (${after})`);
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message.split("\n")[0]}`);
} finally {
  // Everything this run made, round the guards (LOCAL database only).
  sql(`
    set session_replication_role = replica;
    delete from public.admin_notifications where admin_request_id in (select id from public.admin_requests where requested_by = '${id.sup}');
    delete from public.admin_emails where admin_action_id in (select id from public.admin_actions where admin_id in ('${id.owner}', '${id.sup}'));
    delete from public.admin_actions where admin_id in ('${id.owner}', '${id.sup}');
    delete from public.admin_requests where requested_by = '${id.sup}';
    delete from public.booking_emails where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.booking_events where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.booking_contacts where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.booking_finances where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.notifications where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.bookings where customer_id = '${id.cust}';
    delete from public.experience_sessions where listing_id in (select id from public.listings where title = 'Race crawl ${run}');
    delete from public.listing_photos where listing_id in (select id from public.listings where title = 'Race crawl ${run}');
    delete from public.listings where title = 'Race crawl ${run}';
    delete from public.providers where owner_id = '${id.powner}';
    delete from public.categories where slug = 'race-${run}';
    delete from public.service_areas where name = 'Race Ward ${run}';
    delete from public.admin_members where user_id in ('${id.owner}', '${id.sup}');
    delete from auth.sessions where user_id in ('${id.owner}', '${id.sup}');
    delete from auth.users where id in ('${id.owner}', '${id.sup}', '${id.powner}', '${id.cust}');`);
}
console.log(failures ? `${failures} failed` : "All request race checks passed.");
process.exit(failures ? 1 : 0);
