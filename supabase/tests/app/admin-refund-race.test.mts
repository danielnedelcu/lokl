// Support's refunds started at the same moment (admin roles, step 5c;
// migration admin_contact_views): the daily refund total must hold although
// no lock can be held across the Stripe call. admin_check_refund reserves
// each refund before Stripe under a per-person lock. Two real database
// sessions, on the LOCAL stack: A reserves a $130 refund and holds its
// transaction open (as if Stripe were slow to answer); B starts a second
// $130 refund a moment later. With a $200 daily total, B must wait for A,
// see A's reservation, and be refused.
// Run: npx tsx supabase/tests/app/admin-refund-race.test.mts

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
    const p = spawn("psql", [dbUrl, "-X", "-q", "-At"], { stdio: ["pipe", "pipe", "pipe"] });
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
const asServerForSupport = `
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select set_config('request.headers', '{"x-lokl-admin-session":"${id.supSession}"}', true);
  set local role service_role;`;
let settingsBefore = "";
let bookings: string[] = [];

try {
  settingsBefore = sql(`select support_refund_cents_per_day || ',' || support_refunds_per_day from public.admin_settings where id`);
  // Fixtures, committed (both sessions must see them). Test logins only.
  const out = sql(`
    insert into auth.users (id, email, aud, role, instance_id) values
      ('${id.owner}', 'refund-race-owner-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      ('${id.sup}', 'refund-race-support-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      ('${id.powner}', 'refund-race-provider-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      ('${id.cust}', 'refund-race-customer-${run}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
    insert into public.admin_members (user_id, role, status, joined_at) values
      ('${id.owner}', 'owner', 'active', now()), ('${id.sup}', 'support', 'active', now());
    insert into auth.sessions (id, user_id, aal, created_at, updated_at) values ('${id.supSession}', '${id.sup}', 'aal2', now(), now());
    with c as (select id from public.cities where slug = 'atlanta'),
         p as (insert into public.providers (owner_id, display_name, city_id) select '${id.powner}', 'Refund Race ${run}', c.id from c returning id),
         k as (insert into public.categories (kind, name, slug) values ('experience', 'Refund race ${run}', 'refund-race-${run}') returning id),
         a as (insert into public.service_areas (city_id, kind, name) select c.id, 'neighborhood', 'Refund Race Ward ${run}' from c returning id)
    insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
    select p.id, 'experience', k.id, c.id, 'Refund race crawl ${run}', 'Four taquerias on the BeltLine, with stories.', 6500, 60, a.id, 'submitted'
      from p, k, a, c;
    insert into public.listing_photos (listing_id, storage_path, position, alt_text)
    select l.id, l.provider_id || '/' || l.id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from public.listings l where l.title = 'Refund race crawl ${run}';
    update public.listings set status = 'live', published_at = now() where title = 'Refund race crawl ${run}';
    insert into public.experience_sessions (listing_id, starts_at, capacity)
    select id, now() + interval '7 days', 10 from public.listings where title = 'Refund race crawl ${run}';
    begin;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    create temp table race_bookings on commit drop as
      select (public.reserve_experience_booking(s.id, '${id.cust}', 2::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id as id
        from public.experience_sessions s join public.listings l on l.id = s.listing_id, generate_series(1, 2)
       where l.title = 'Refund race crawl ${run}';
    update public.bookings set status = 'confirmed', status_changed_by = 'stripe' where id in (select id from race_bookings);
    select id from race_bookings;
    commit;
    -- A $200 daily total (restored afterwards).
    update public.admin_settings set support_refund_cents_per_day = 20000, support_refunds_per_day = 5;`);
  bookings = out.split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l));
  check(bookings.length === 2, "0. two paid $130 bookings, a $200 daily total for support");

  // A: the first refund reserved, its transaction held open (Stripe slow to answer).
  const a = session(`
    begin;
    ${asServerForSupport}
    select public.admin_check_refund('${id.sup}', '${bookings[0]}');
    select pg_sleep(3);
    commit;`);
  await new Promise((r) => setTimeout(r, 1000));
  // B: the second refund, started a moment later.
  const b = session(`
    begin;
    ${asServerForSupport}
    select public.admin_check_refund('${id.sup}', '${bookings[1]}');
    commit;`);
  const [ra, rb] = await Promise.all([a, b]);
  check(ra.out.split("\n").includes("13000") && !ra.err.includes("ERROR"), "1a. A reserves the first $130 refund");
  check(rb.ms >= 1500, `1b. B waited for A's reservation (${rb.ms} ms)`);
  check(rb.err.includes("This refund would take you past today's $200.00 for refunds ($130.00 so far)."),
    `1c. B is refused: A's refund in flight counts (${rb.err.split("\n").find((l) => l.includes("ERROR")) ?? "no error"})`);
  check(sql(`select count(*) from public.admin_refund_holds where admin_id = '${id.sup}'`) === "1", "1d. only A's reservation stands");
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message.split("\n")[0]}`);
} finally {
  const [cents, count] = settingsBefore.split(",");
  sql(`
    ${cents && count ? `update public.admin_settings set support_refund_cents_per_day = ${Number(cents)}, support_refunds_per_day = ${Number(count)};` : ""}
    set session_replication_role = replica;
    delete from public.admin_refund_holds where admin_id = '${id.sup}';
    delete from public.booking_emails where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.booking_events where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.booking_contacts where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.booking_finances where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.notifications where booking_id in (select id from public.bookings where customer_id = '${id.cust}');
    delete from public.bookings where customer_id = '${id.cust}';
    delete from public.experience_sessions where listing_id in (select id from public.listings where title = 'Refund race crawl ${run}');
    delete from public.listing_photos where listing_id in (select id from public.listings where title = 'Refund race crawl ${run}');
    delete from public.listings where title = 'Refund race crawl ${run}';
    delete from public.providers where owner_id = '${id.powner}';
    delete from public.categories where slug = 'refund-race-${run}';
    delete from public.service_areas where name = 'Refund Race Ward ${run}';
    delete from public.admin_members where user_id in ('${id.owner}', '${id.sup}');
    delete from auth.sessions where user_id in ('${id.owner}', '${id.sup}');
    delete from auth.users where id in ('${id.owner}', '${id.sup}', '${id.powner}', '${id.cust}');`);
}
console.log(failures ? `${failures} failed` : "All refund race checks passed.");
process.exit(failures ? 1 : 0);
