-- Category counts on a market page (migration public_category_counts):
-- visible listings per category, counted by the database as a visitor sees
-- them, past the API's 1,000 rows.
begin;
\ir _helpers/users.psql
select plan(5);

select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('paused@test.local') as pausedowner \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into cities (slug, name, state, timezone) values ('savannah', 'Savannah', 'GA', 'America/New_York') returning id as sav \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Peach Tours', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id, status) values (:'pausedowner', 'Paused Tours', :'atl', 'suspended') returning id as paused \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as food \gset
insert into categories (kind, name, slug) values ('experience', 'History', 'history') returning id as hist \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'hair') returning id as hair \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Midtown') returning id as midtown \gset
insert into service_areas (city_id, kind, name) values (:'sav', 'neighborhood', 'Historic District') returning id as savarea \gset

-- Listings written with the guards off; visitors' read rules still apply.
set local session_replication_role = replica;
insert into listings (id, slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, location_mode, created_at, booking_mode) values
  ('00000000-0000-4000-8000-0000000000e1', 'browse-e1', :'p', 'experience', :'food', :'atl', 'B walk', 'A browse test listing, long enough.', 5000, 60, :'o4w', 'live', null, now(), null),
  ('00000000-0000-4000-8000-0000000000e2', 'browse-e2', :'p', 'experience', :'hist', :'atl', 'A walk', 'A browse test listing, long enough.', 5000, 60, :'midtown', 'live', null, now(), null),
  ('00000000-0000-4000-8000-0000000000e3', 'browse-e3', :'p', 'experience', :'food', :'atl', 'C walk', 'A browse test listing, long enough.', 5000, 60, :'o4w', 'live', null, now(), null),
  ('00000000-0000-4000-8000-0000000000e4', 'browse-e4', :'p', 'experience', :'food', :'atl', 'Draft walk', 'A browse test listing, long enough.', 5000, 60, :'o4w', 'draft', null, now(), null),
  ('00000000-0000-4000-8000-0000000000e5', 'browse-e5', :'paused', 'experience', :'food', :'atl', 'Paused walk', 'A browse test listing, long enough.', 5000, 60, :'o4w', 'live', null, now(), null),
  ('00000000-0000-4000-8000-0000000000e6', 'browse-e6', :'p', 'experience', :'food', :'sav', 'Savannah walk', 'A browse test listing, long enough.', 5000, 60, :'savarea', 'live', null, now(), null),
  ('00000000-0000-4000-8000-0000000000a1', 'browse-a1', :'p', 'service', :'hair', :'atl', 'Old cut', 'A browse test listing, long enough.', 4500, 60, :'o4w', 'live', 'customer_location', now() - interval '2 days', 'approve'),
  ('00000000-0000-4000-8000-0000000000a2', 'browse-a2', :'p', 'service', :'hair', :'atl', 'New cut', 'A browse test listing, long enough.', 4500, 60, :'o4w', 'live', 'customer_location', now() - interval '1 day', 'approve');
-- Sessions: e1 in 2 days, e2 in 1 day, e3 none upcoming (only a past one,
-- and a cancelled one tomorrow).
insert into experience_sessions (listing_id, starts_at, capacity, status) values
  ('00000000-0000-4000-8000-0000000000e1', now() + interval '2 days', 10, 'scheduled'),
  ('00000000-0000-4000-8000-0000000000e1', now() + interval '9 days', 10, 'scheduled'),
  ('00000000-0000-4000-8000-0000000000e2', now() + interval '1 day', 10, 'scheduled'),
  ('00000000-0000-4000-8000-0000000000e3', now() - interval '1 day', 10, 'scheduled'),
  ('00000000-0000-4000-8000-0000000000e3', now() + interval '1 day', 10, 'cancelled');
-- The second service travels to Midtown.
insert into listing_service_areas (listing_id, service_area_id) values ('00000000-0000-4000-8000-0000000000a2', :'midtown');
set local session_replication_role = origin;


select tests.authenticate_as_anon();
select is(public_category_counts(:'atl'), jsonb_build_object(:'food', 2, :'hist', 1, :'hair', 2),
  '1a. visible listings per category (not the draft or the suspended provider''s)');
select is(public_category_counts(:'sav'), jsonb_build_object(:'food', 1), '1b. per market');
select tests.clear_authentication();

-- 2. Past 1,000: 1,050 more, all counted.
set local session_replication_role = replica;
insert into listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
select 'many-' || g, :'p', 'experience', :'hist', :'atl', 'Many ' || g, 'A count test listing, long enough.', 5000, 60, :'o4w', 'live' from generate_series(1, 1050) g;
set local session_replication_role = origin;
select tests.authenticate_as_anon();
select is(public_category_counts(:'atl') -> :'hist', '1051'::jsonb, '2. 1,051 visible listings in one category are all counted');
select tests.clear_authentication();

-- 3. Who may call it.
select ok(has_function_privilege('anon', 'public.public_category_counts(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.public_category_counts(uuid)', 'EXECUTE'),
  '3a. visitors and signed-in users call it');
select ok(not has_function_privilege('service_role', 'public.public_category_counts(uuid)', 'EXECUTE'), '3b. the server key doesn''t');

select * from finish();
rollback;
