-- Service availability, phase 2 (docs/design/service-availability.md):
-- every Service has a mode and a duration; saving weekly or date hours is
-- one step (all or none); the provider's own slot preview; and Services the
-- provider approves need at least 4 hours' notice in the slots customers see.
begin;
\ir _helpers/users.psql
select plan(30);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('settings-provider@test.local') as owner \gset
select tests.create_user('settings-other@test.local') as other_owner \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Settings Studio', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'other_owner', 'Other Settings Studio', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'settings-hair') returning id as svc \gset
insert into categories (kind, name, slug) values ('experience', 'Walks', 'settings-walks') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Settings Ward') returning id as area \gset

-- A draft Service of each provider (not live, payouts not set up).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p', 'service', :'svc', :'atl', 'Draft studio haircut', 'A classic cut, with a wash and style.', 4500, 60, 'provider_location', :'area', 'approve')
returning id as ls \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p2', 'service', :'svc', :'atl', 'Other draft haircut', 'Another classic cut, with a wash.', 4000, 60, 'provider_location', :'area', 'instant')
returning id as ls2 \gset

-- ---------------------------------------------------------------------------
-- 1. EVERY SERVICE HAS A MODE AND A DURATION
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id)
  values (%L, 'service', %L, %L, 'No mode haircut', 'A cut whose provider chose no mode.', 4500, 60, 'provider_location', %L) $$, :'p', :'svc', :'atl', :'area'),
  '23514', null, '1a. a Service without a booking mode is refused');
select throws_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
  values (%L, 'service', %L, %L, 'Ten minute cut', 'Too short to book as a Service.', 4500, 10, 'provider_location', %L, 'instant') $$, :'p', :'svc', :'atl', :'area'),
  '23514', null, '1b. ...or one shorter than 15 minutes');
select throws_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
  values (%L, 'service', %L, %L, 'All day cut', 'Longer than twelve hours.', 4500, 800, 'provider_location', %L, 'instant') $$, :'p', :'svc', :'atl', :'area'),
  '23514', null, '1c. ...or one longer than 12 hours');
select throws_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id, booking_mode)
  values (%L, 'service', %L, %L, 'No duration cut', 'A cut without a duration.', 4500, 'provider_location', %L, 'instant') $$, :'p', :'svc', :'atl', :'area'),
  '23514', null, '1d. ...or one without a duration');
select lives_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
  values (%L, 'service', %L, %L, 'Instant studio cut', 'A cut booked and paid in one go.', 4500, 45, 'provider_location', %L, 'instant') $$, :'p', :'svc', :'atl', :'area'),
  '1e. a Service with a mode and 45 minutes is saved');
select lives_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
  values (%L, 'experience', %L, %L, 'Short neighbourhood walk', 'A ten minute walk, with stories.', 1000, 10, %L) $$, :'p', :'exp', :'atl', :'area'),
  '1f. Experiences need no mode, and keep their own duration rule');
select lives_ok(format($$ update listings set booking_mode = 'instant', buffer_minutes = 15 where id = %L $$, :'ls'),
  '1g. the provider changes a Service''s mode and buffer');
select throws_ok(format($$ update listings set booking_mode = null where id = %L $$, :'ls'),
  '23514', null, '1h. ...but can''t remove its mode');

-- ---------------------------------------------------------------------------
-- 2. SAVING HOURS: ALL OR NONE
-- ---------------------------------------------------------------------------

select is(replace_weekly_hours('[{"weekday": 1, "starts": "09:00", "ends": "12:00"}, {"weekday": 1, "starts": "13:00", "ends": "17:00"}]'::jsonb), 2,
  '2a. a provider saves their weekly hours: two intervals on Monday');
select throws_ok($$ select replace_weekly_hours('[{"weekday": 2, "starts": "09:00", "ends": "12:00"}, {"weekday": 2, "starts": "11:00", "ends": "14:00"}]'::jsonb) $$,
  '23P01', 'Two of the hours on one day overlap.', '2b. hours that overlap are refused...');
select is((select array_agg(starts::text order by starts) from provider_weekly_hours), array['09:00:00', '13:00:00'],
  '2c. ...and none of that save happens: Monday''s hours are as they were');
select throws_ok($$ select replace_weekly_hours('[{"weekday": 3, "starts": "17:00", "ends": "09:00"}]'::jsonb) $$,
  '23514', 'Each set of hours ends after it starts.', '2d. hours that end before they start are refused');
select throws_ok($$ select replace_weekly_hours('[{"weekday": 9, "starts": "09:00", "ends": "17:00"}]'::jsonb) $$,
  '23514', 'Those hours couldn''t be saved.', '2d2. any other check (a weekday that doesn''t exist) says something general');
select throws_ok($$ select replace_date_hours((now() at time zone 'America/New_York')::date + 10, '[{"starts": "14:00", "ends": "10:00"}]'::jsonb) $$,
  '23514', 'Each set of hours ends after it starts.', '2d3. a date''s hours that end before they start say so too');
select is(replace_date_hours((now() at time zone 'America/New_York')::date + 10, '[{"starts": "10:00", "ends": "14:00"}]'::jsonb), 1,
  '2e. a provider saves hours for one date');
select is(replace_date_hours((now() at time zone 'America/New_York')::date + 10, '[]'::jsonb), 0,
  '2f. ...and an empty list goes back to the weekly hours');
select is((select count(*)::int from provider_date_hours), 0, '2g. (no hours left for that date)');

select tests.authenticate_as(:'other_owner');
select is(replace_weekly_hours('[]'::jsonb), 0, '2h. another provider''s save...');
select tests.clear_authentication();
select is((select count(*)::int from provider_weekly_hours where provider_id = :'p'), 2, '2i. ...never touches this provider''s hours');

select tests.create_user('settings-customer@test.local') as cust \gset
select tests.authenticate_as(:'cust');
select throws_ok($$ select replace_weekly_hours('[]'::jsonb) $$, '42501', 'Set up your business first.', '2j. someone without a business can''t save hours');
select tests.authenticate_as_anon();
select throws_ok($$ select replace_weekly_hours('[]'::jsonb) $$, '42501', null, '2k. visitors can''t call it');

-- ---------------------------------------------------------------------------
-- 3. THE PROVIDER'S PREVIEW
-- ---------------------------------------------------------------------------

-- Monday hours for this provider; the other provider has Monday hours too.
select tests.clear_authentication();
insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (:'p2', 1, '09:00', '17:00');
-- The next Monday at least two days ahead, in Atlanta.
select d as monday from generate_series((now() at time zone 'America/New_York')::date + 2, (now() at time zone 'America/New_York')::date + 8, interval '1 day') d
 where extract(dow from d) = 1 limit 1 \gset

select tests.authenticate_as(:'owner');
select is((select count(*)::int from my_service_slots_preview(:'ls', :'monday'::date, :'monday'::date)), 12,
  '3a. a provider previews their own draft Service before payouts are set up: 9:00 to 11:00 and 13:00 to 16:00, every 30 minutes');
select is((select count(*)::int from service_slots(:'ls', :'monday'::date, :'monday'::date)), 0,
  '3b. ...while customers see none (it isn''t live, and payouts aren''t set up)');
select throws_ok(format($$ select * from my_service_slots_preview(%L, %L::date, %L::date) $$, :'ls2', :'monday', :'monday'),
  '42501', 'That isn''t one of your listings.', '3c. a provider can''t preview another provider''s Service');
select tests.authenticate_as_anon();
select throws_ok(format($$ select * from my_service_slots_preview(%L, %L::date, %L::date) $$, :'ls', :'monday', :'monday'),
  '42501', null, '3d. visitors can''t call the preview');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.service_slots_core(uuid,date,date,timestamptz,boolean)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.service_slots_core(uuid,date,date,timestamptz,boolean)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.service_slots_core(uuid,date,date,timestamptz,boolean)', 'EXECUTE'),
  '3e. the shared core reaches no API role');

-- ---------------------------------------------------------------------------
-- 4. APPROVAL NEEDS 4 HOURS' NOTICE, WHATEVER THE PROVIDER'S
-- ---------------------------------------------------------------------------

-- One hour's notice, open all day on a fixed date; as of 9:00 that morning.
update listings set booking_mode = 'instant', buffer_minutes = null where id = :'ls';
insert into provider_schedules (provider_id, min_notice_minutes) values (:'p', 60);
insert into provider_date_hours (provider_id, on_date, starts, ends) values (:'p', '2027-03-10', '00:00', '24:00');
create function pg_temp.local_starts(p_listing uuid) returns text[] language sql stable as $$
  select array_agg(to_char(starts_at at time zone 'America/New_York', 'HH24:MI') order by starts_at)
    from public.service_slots_core(p_listing, '2027-03-10', '2027-03-10', '2027-03-10 09:00-05', false) $$;
select ok('11:00' = any (pg_temp.local_starts(:'ls')), '4a. with 1 hour''s notice, an Instant Service offers a slot 2 hours ahead (11:00)');
select is((pg_temp.local_starts(:'ls'))[1], '10:00', '4b. ...its first slot an hour ahead');
update listings set booking_mode = 'approve' where id = :'ls';
select ok(not ('11:00' = any (pg_temp.local_starts(:'ls'))), '4c. an Approve Service doesn''t offer that slot');
select is((pg_temp.local_starts(:'ls'))[1], '13:00', '4d. ...its first slot is 4 hours ahead (13:00)');

select * from finish();
rollback;
