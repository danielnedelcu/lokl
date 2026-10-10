-- The sessions panel's counts (migration listing_sessions_page): one page of
-- upcoming or past sessions, each with its booking rows, seats booked and
-- refund total, counted in the database; read with the caller's rules.
begin;
\ir _helpers/users.psql
select plan(14);

select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('other@test.local') as other \gset
select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Peach Tours', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'other', 'Other Tours', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'cat', :'atl', 'Taco crawl', 'A listing made for the sessions page tests.', 5000, 60, :'o4w', 'draft')
returning id as l \gset

-- Three upcoming sessions and two past ones, written with the guards off.
set local session_replication_role = replica;
insert into experience_sessions (id, listing_id, starts_at, capacity) values
  ('00000000-0000-4000-8000-000000000001', :'l', now() + interval '1 day', 10),
  ('00000000-0000-4000-8000-000000000002', :'l', now() + interval '2 days', 10),
  ('00000000-0000-4000-8000-000000000003', :'l', now() + interval '3 days', 10),
  ('00000000-0000-4000-8000-000000000004', :'l', now() - interval '1 day', 10),
  ('00000000-0000-4000-8000-000000000005', :'l', now() - interval '2 days', 10);
-- The first upcoming session: two confirmed bookings (2 and 3 people) and an
-- abandoned checkout.
insert into bookings (kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, party_size, total_cents, status, starts_at, ends_at)
values
  ('experience', :'l', :'p', :'cust', '00000000-0000-4000-8000-000000000001', 'Sam', 5000, 2, 10000, 'confirmed', now() + interval '1 day', now() + interval '25 hours'),
  ('experience', :'l', :'p', :'cust', '00000000-0000-4000-8000-000000000001', 'Ann', 5000, 3, 15000, 'confirmed', now() + interval '1 day', now() + interval '25 hours'),
  ('experience', :'l', :'p', :'cust', '00000000-0000-4000-8000-000000000001', 'Joe', 5000, 1, 5000, 'expired', now() + interval '1 day', now() + interval '25 hours');
set local session_replication_role = origin;

-- 1. The provider: upcoming, soonest first, with the counts.
select tests.authenticate_as(:'owner');
select is((listing_sessions_page(:'l', false) ->> 'total')::int, 3, '1a. the provider''s listing has 3 upcoming sessions');
select is((select array_agg(e ->> 'id' order by o) from jsonb_array_elements(listing_sessions_page(:'l', false) -> 'items') with ordinality x(e, o)),
  array['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'],
  '1b. ...soonest first');
select is((listing_sessions_page(:'l', false) -> 'items' -> 0) - array['starts_at', 'id', 'capacity', 'status'],
  '{"booked": 5, "booking_rows": 3, "refund_cents": 25000}'::jsonb,
  '1c. the first: 3 booking rows, 5 seats booked, 250.00 to refund (the abandoned checkout counts as a row only)');
select is((listing_sessions_page(:'l', false) -> 'items' -> 1 ->> 'booking_rows')::int, 0, '1d. a session without bookings has none');

-- 2. Paging, and past sessions most recent first.
select is(jsonb_array_length(listing_sessions_page(:'l', false, 1, 2) -> 'items'), 2, '2a. a page of 2');
select is(listing_sessions_page(:'l', false, 2, 2) -> 'items' -> 0 ->> 'id', '00000000-0000-4000-8000-000000000003', '2b. ...the next page carries on');
select is((listing_sessions_page(:'l', true) ->> 'total')::int, 2, '2c. 2 past sessions');
select is(listing_sessions_page(:'l', true) -> 'items' -> 0 ->> 'id', '00000000-0000-4000-8000-000000000004', '2d. ...most recent first');
select tests.clear_authentication();

-- 3. A page holds at most 100.
set local session_replication_role = replica;
insert into experience_sessions (listing_id, starts_at, capacity)
select :'l', now() + interval '10 days' + g * interval '1 hour', 10 from generate_series(1, 120) g;
set local session_replication_role = origin;
select tests.authenticate_as(:'owner');
select is(jsonb_array_length(listing_sessions_page(:'l', false, 1, 1000) -> 'items'), 100, '3a. asking for 1,000 gets a page of 100');
select is((listing_sessions_page(:'l', false, 1, 1000) ->> 'total')::int, 123, '3b. ...and the total counts all 123');
select tests.clear_authentication();

-- 4. Read with the caller's rules.
select tests.authenticate_as(:'other');
select is((listing_sessions_page(:'l', false) ->> 'total')::int, 0, '4a. another provider sees none of them');
select tests.clear_authentication();
select tests.authenticate_as_admin(:'admin');
select is((listing_sessions_page(:'l', false) -> 'items' -> 0 ->> 'booked')::int, 5, '4b. an admin sees the counts');
select tests.clear_authentication();
select tests.authenticate_as_anon();
select throws_ok(format($$ select listing_sessions_page(%L, false) $$, :'l'), '42501', 'permission denied for function listing_sessions_page',
  '4c. a visitor can''t call it');
select tests.clear_authentication();
select tests.authenticate_as_service_role();
select throws_ok(format($$ select listing_sessions_page(%L, false) $$, :'l'), '42501', 'permission denied for function listing_sessions_page',
  '4d. nor the server key (only signed-in users use it)');
select tests.clear_authentication();

select * from finish();
rollback;
