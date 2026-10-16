-- Browse pages (migration public_browse): the database picks one page of
-- visible listing ids in browse order, with the total, as a visitor sees
-- them, past the API's 1,000 rows.
begin;
\ir _helpers/users.psql
select plan(16);

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

create function pg_temp.ids(j jsonb) returns text[] language sql as $$ select array(select jsonb_array_elements_text(j -> 'ids')) $$;
grant execute on function pg_temp.ids(jsonb) to anon;

-- 1. A visitor browsing Experiences.
select tests.authenticate_as_anon();
select is(pg_temp.ids(public_browse('atlanta', 'experience')),
  array['00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e3'],
  '1a. soonest next session first; one with no upcoming session (past or cancelled only) last');
select is((public_browse('atlanta', 'experience') ->> 'total')::int, 3, '1b. 3 visible: not the draft, the suspended provider''s, or another market''s');
select is(pg_temp.ids(public_browse('atlanta', 'experience', 'food')),
  array['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e3'], '1c. a category');
select is(pg_temp.ids(public_browse('atlanta', 'experience', null, :'midtown')),
  array['00000000-0000-4000-8000-0000000000e2'], '1d. an area');
select is(pg_temp.ids(public_browse('atlanta', 'experience', null, null, now() + interval '36 hours', now() + interval '3 days')),
  array['00000000-0000-4000-8000-0000000000e1'], '1e. dates: a session from the first, before the second');
select is(pg_temp.ids(public_browse('atlanta', 'experience', null, null, now() + interval '5 days', null)),
  array['00000000-0000-4000-8000-0000000000e1'], '1f. ...or from a date on');
select is((public_browse('atlanta', 'experience', 'nonsense') ->> 'total')::int, 0, '1g. an unknown category: none');

-- 2. Services: newest first; an area they travel to counts.
select is(pg_temp.ids(public_browse('atlanta', 'service')),
  array['00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1'], '2a. Services newest first');
select is(pg_temp.ids(public_browse('atlanta', 'service', null, :'midtown')),
  array['00000000-0000-4000-8000-0000000000a2'], '2b. a Service travelling to the area');
select is((public_browse('atlanta', 'service', null, null, now() + interval '3 days', now() + interval '4 days') ->> 'total')::int, 0,
  '2c. dates filter Services too: with no hours, they never match (service_open_days.test.sql has the rest)');

-- 3. Paging.
select is(pg_temp.ids(public_browse('atlanta', 'experience', null, null, null, null, 2, 2)),
  array['00000000-0000-4000-8000-0000000000e3'], '3a. the second page of 2 holds the third');
select is(jsonb_array_length(public_browse('atlanta', 'experience', null, null, null, null, 0, 0) -> 'ids'), 1, '3b. page and size below 1 count as 1');

select tests.clear_authentication();

-- 5. Past 1,000: 1,050 more Experiences, counted and paged in full.
set local session_replication_role = replica;
insert into listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
select 'many-' || g, :'p', 'experience', :'hist', :'atl', 'Many ' || g, 'A browse test listing, long enough.', 5000, 60, :'o4w', 'live' from generate_series(1, 1050) g;
set local session_replication_role = origin;
select tests.authenticate_as_anon();
select is((public_browse('atlanta', 'experience') ->> 'total')::int, 1053, '5a. 1,053 visible Experiences are all counted');
select is(jsonb_array_length(public_browse('atlanta', 'experience', null, null, null, null, 44, 24) -> 'ids'), 21, '5b. ...and the 44th page of 24 holds the last 21');
select is(jsonb_array_length(public_browse('atlanta', 'experience', null, null, null, null, 1, 1000) -> 'ids'), 100, '5c. a page holds at most 100');
select tests.clear_authentication();

-- 6. Who may call them.
select ok(has_function_privilege('anon', 'public.public_browse(text,text,text,uuid,timestamptz,timestamptz,int,int)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.public_browse(text,text,text,uuid,timestamptz,timestamptz,int,int)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.public_browse(text,text,text,uuid,timestamptz,timestamptz,int,int)', 'EXECUTE'),
  '6. visitors and signed-in users call it; the server key doesn''t');

select * from finish();
rollback;
