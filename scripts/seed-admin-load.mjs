#!/usr/bin/env node
// Load data for the admin search pages: 200 providers (two markets), 1,000
// listings, 2,000 customers and 10,000 bookings with their money and
// contacts. LOCAL DATABASE ONLY: refuses anything but the local stack.
//
//   node scripts/seed-admin-load.mjs           add the load data
//   node scripts/seed-admin-load.mjs --remove  take it all out again
//
// Everything it adds is marked: logins end in @load.test.local, the market
// is "Loadville", categories and areas start with "Load". It runs in ONE
// transaction with ON_ERROR_STOP. The booking, finances and session guards
// are switched off inside that transaction (ALTER TABLE ... DISABLE TRIGGER
// is transactional), so if anything fails partway, the rollback switches
// them back on along with everything else. After the commit it checks, in a
// separate query, that every trigger it touched is enabled, and fails loudly
// if one isn't.

import { execFileSync } from "node:child_process";

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = env.DB_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(db)) {
  console.error("Refusing to run: this only seeds the local database (`npx supabase start`).");
  process.exit(1);
}

const GUARDED = [
  ["public.bookings", "bookings_guard"],
  ["public.booking_finances", "booking_finances_guard"],
  ["public.experience_sessions", "experience_sessions_guard"],
  ["public.experience_sessions", "experience_sessions_check"],
];
const off = GUARDED.map(([t, g]) => `alter table ${t} disable trigger ${g};`).join("\n");
const on = GUARDED.map(([t, g]) => `alter table ${t} enable trigger ${g};`).join("\n");

const psql = (sql, label) => {
  const started = Date.now();
  execFileSync("psql", [db, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
  console.log(`${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
};

const remove = `
${off}
create temp table load_ids on commit drop as
  select b.id from public.bookings b join auth.users u on u.id = b.customer_id where u.email like '%@load.test.local';
delete from public.notifications where booking_id in (select id from load_ids)
  or provider_id in (select p.id from public.providers p join auth.users u on u.id = p.owner_id where u.email like '%@load.test.local');
delete from public.booking_events where booking_id in (select id from load_ids);
delete from public.booking_emails where booking_id in (select id from load_ids);
delete from public.booking_reports where booking_id in (select id from load_ids);
delete from public.booking_addresses where booking_id in (select id from load_ids);
delete from public.booking_finances where booking_id in (select id from load_ids);
delete from public.booking_contacts where booking_id in (select id from load_ids);
delete from public.bookings where id in (select id from load_ids);
delete from public.experience_sessions where listing_id in (select l.id from public.listings l join public.providers p on p.id = l.provider_id join auth.users u on u.id = p.owner_id where u.email like '%@load.test.local');
delete from public.listings where provider_id in (select p.id from public.providers p join auth.users u on u.id = p.owner_id where u.email like '%@load.test.local');
delete from public.providers where owner_id in (select id from auth.users where email like '%@load.test.local');
delete from auth.users where email like '%@load.test.local';
delete from public.service_areas where name like 'Load %';
delete from public.categories where slug like 'load-%';
delete from public.cities where slug = 'loadville';
${on}
`;

const seed = `
${off}

-- Two markets: Atlanta (already there) and Loadville.
insert into public.cities (slug, name, state, timezone) values ('loadville', 'Loadville', 'GA', 'America/New_York');
insert into public.categories (kind, name, slug) values ('experience', 'Load tours', 'load-tours'), ('service', 'Load hair', 'load-hair');
insert into public.service_areas (city_id, kind, name)
select id, 'neighborhood', 'Load ' || name from public.cities where slug in ('atlanta', 'loadville');

-- 200 owners and 2,000 customers.
insert into auth.users (id, email) select gen_random_uuid(), 'owner' || n || '@load.test.local' from generate_series(1, 200) n;
insert into auth.users (id, email) select gen_random_uuid(), 'customer' || n || '@load.test.local' from generate_series(1, 2000) n;

-- 200 providers: a third with payouts ready, a third partway, a third not
-- started; about 5% suspended.
insert into public.providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, status)
select u.id,
  (array['Peach','Magnolia','Harbor','Pine','River','Copper','Juniper','Oak','Willow','Cedar'])[1 + n % 10] || ' ' ||
  (array['Tours','Studio','Walks','Kitchen','Salon','Collective','Workshop','Outfitters'])[1 + (n / 10) % 8] || ' ' || n,
  (select id from public.cities where slug = case when n % 4 = 0 then 'loadville' else 'atlanta' end),
  case when n % 3 = 0 then null else 'acct_load_' || n end,
  n % 3 <> 0, n % 3 = 1,
  case when n % 20 = 0 then 'suspended' else 'active' end
from (select id, row_number() over (order by email) as n from auth.users where email like 'owner%@load.test.local') u;

-- 1,000 listings: 600 Experiences and 400 Services, mostly live.
insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, location_mode, status, published_at, unpublished_reason)
select p.id, k.kind,
  (select id from public.categories where slug = case when k.kind = 'experience' then 'load-tours' else 'load-hair' end),
  p.city_id,
  (array['Sunset','Historic','Hidden','Garden','Night','Morning','Street art','Riverside','Market','Jazz'])[1 + n % 10] || ' ' ||
  case when k.kind = 'experience' then (array['walk','crawl','tour','class','tasting'])[1 + (n / 10) % 5] else (array['silk press','braids','trim','color','consult'])[1 + (n / 10) % 5] end || ' ' || n,
  'A listing made by the admin load seed, with enough words.',
  1500 + (n % 40) * 250, 60 + (n % 4) * 30,
  (select id from public.service_areas where city_id = p.city_id and name like 'Load %'),
  case when k.kind = 'service' then 'provider_location' end,
  case when n % 12 = 0 then 'draft' when n % 17 = 0 then 'unpublished' else 'live' end,
  case when n % 12 = 0 then null else now() - interval '200 days' end,
  case when n % 12 <> 0 and n % 17 = 0 then 'Taken down by the load seed.' end
from generate_series(1, 1000) n
cross join lateral (select case when n <= 600 then 'experience' else 'service' end as kind) k
cross join lateral (select id, city_id from public.providers where display_name like '% ' || (1 + n % 200)) p;

-- One session per Experience, which its bookings hang off.
insert into public.experience_sessions (listing_id, starts_at, capacity)
select id, now() + interval '10 days', 500 from public.listings where kind = 'experience' and category_id = (select id from public.categories where slug = 'load-tours');

-- 10,000 bookings across a year, every status, by 2,000 customers.
create temp table load_bookings on commit drop as
select gen_random_uuid() as id, n, l.id as listing_id, l.kind, l.provider_id, l.price_cents,
  (select id from public.experience_sessions s where s.listing_id = l.id limit 1) as session_id,
  c.id as customer_id, c.first, c.last,
  (array['requested','confirmed','confirmed','completed','completed','paid_out','paid_out','paid_out','cancelled','declined','expired'])[1 + n % 11] as status,
  now() - (n % 365) * interval '1 day' - (n % 24) * interval '1 hour' as created_at
from generate_series(1, 10000) n
cross join lateral (select id, kind, provider_id, price_cents from public.listings where category_id in (select id from public.categories where slug like 'load-%') offset (n * 7919) % 1000 limit 1) l
cross join lateral (
  select u.id,
    (array['Sam','Alex','Jordan','Taylor','Morgan','Casey','Riley','Jamie','Avery','Quinn','Maria','Wei','Aisha','Diego','Priya'])[1 + n % 15] as first,
    (array['Rivera','Nguyen','Smith','Johnson','Okafor','Garcia','Kim','Patel','Brown','Lee','Cohen','Davis'])[1 + (n / 15) % 12] as last
  from auth.users u where u.email = 'customer' || (1 + n % 2000) || '@load.test.local'
) c;

insert into public.bookings (id, kind, listing_id, provider_id, customer_id, session_id, status, preferred_times, starts_at, ends_at,
  party_size, customer_name, unit_price_cents, total_cents, currency, confirmed_at, payout_due_at, refunded_cents, refunded_at,
  cancelled_by, cancelled_at, status_changed_by, created_at, updated_at, problem_reported_at)
select b.id, b.kind, b.listing_id, b.provider_id, b.customer_id,
  case when b.kind = 'experience' then b.session_id end,
  b.status,
  case when b.kind = 'service' then array[b.created_at + interval '5 days'] end,
  case when b.status in ('confirmed','completed','paid_out','cancelled') then b.created_at + interval '5 days' end,
  case when b.status in ('confirmed','completed','paid_out','cancelled') then b.created_at + interval '5 days 1 hour' end,
  case when b.kind = 'experience' then 1 + b.n % 3 else 1 end,
  b.first || ' ' || b.last,
  b.price_cents, b.price_cents * case when b.kind = 'experience' then 1 + b.n % 3 else 1 end, 'usd',
  case when b.status in ('confirmed','completed','paid_out','cancelled') then b.created_at + interval '1 hour' end,
  case when b.status in ('confirmed','completed','paid_out','cancelled') then b.created_at + interval '6 days' end,
  case when b.status = 'cancelled' then b.price_cents * case when b.kind = 'experience' then 1 + b.n % 3 else 1 end else 0 end,
  case when b.status = 'cancelled' then b.created_at + interval '2 days' end,
  case when b.status = 'cancelled' then 'customer' end,
  case when b.status = 'cancelled' then b.created_at + interval '2 days' end,
  'system', b.created_at, b.created_at,
  case when b.status = 'completed' and b.n % 50 = 0 then b.created_at + interval '6 days' end
from load_bookings b;

-- Their money (15% commission) and contacts; a few in each "needs attention" group.
insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents,
  payout_hold, payout_held_at, reversal_failed_at, reversal_failure, disputed_at)
select b.id, 1500, round(bk.total_cents * 0.15), bk.total_cents - round(bk.total_cents * 0.15),
  case when b.status = 'completed' and b.n % 40 = 0 then 'dispute' end,
  case when b.status = 'completed' and b.n % 40 = 0 then now() end,
  case when b.status = 'paid_out' and b.n % 300 = 0 then now() end,
  case when b.status = 'paid_out' and b.n % 300 = 0 then 'load seed' end,
  case when b.status = 'completed' and b.n % 40 = 0 then now() end
from load_bookings b join public.bookings bk on bk.id = b.id;
insert into public.booking_contacts (booking_id, email)
select b.id, lower(b.first || '.' || b.last || b.n) || '@load.test.local' from load_bookings b;

${on}
`;

const check = () => {
  const rows = execFileSync("psql", [db, "-At", "-c",
    `select c.relname || '.' || t.tgname || ' ' || t.tgenabled::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and c.relname in ('bookings', 'booking_finances', 'experience_sessions') order by 1`], { encoding: "utf8" })
    .trim().split("\n");
  const disabled = rows.filter((r) => !r.endsWith(" O"));
  if (disabled.length) {
    console.error(`FAIL: these triggers are not enabled:\n  ${disabled.join("\n  ")}`);
    process.exit(1);
  }
  const guards = GUARDED.map(([, g]) => g);
  const found = rows.filter((r) => guards.some((g) => r.includes(`.${g} `)));
  console.log(`Guard check: all ${rows.length} triggers on bookings, booking_finances and experience_sessions are enabled, including ${found.map((r) => r.split(" ")[0]).join(", ")}.`);
};

try {
  if (process.argv.includes("--remove")) {
    psql(remove, "Removed the load data");
  } else {
    psql(remove, "Cleared any earlier load data");
    psql(seed, "Seeded the load data");
    const counts = execFileSync("psql", [db, "-At", "-F", " ", "-c",
      `select (select count(*) from public.providers p join auth.users u on u.id = p.owner_id where u.email like '%@load.test.local'),
              (select count(*) from public.listings where category_id in (select id from public.categories where slug like 'load-%')),
              (select count(*) from auth.users where email like 'customer%@load.test.local'),
              (select count(*) from public.bookings b join auth.users u on u.id = b.customer_id where u.email like '%@load.test.local')`], { encoding: "utf8" }).trim().split(" ");
    console.log(`Providers ${counts[0]}, listings ${counts[1]}, customers ${counts[2]}, bookings ${counts[3]}.`);
  }
} finally {
  // Whatever happened above, confirm the guards are on.
  check();
}
