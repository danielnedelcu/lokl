-- The slot core at every hour (2026-10-19): service_slots_at() takes the
-- time to work from, so it's checked at every real hour of four Atlanta
-- days, at 5 past and 5 to (the instants scripts/clock-instants.mjs gives
-- test:clock): a Wednesday, a Saturday and both clock-change days. The
-- real-clock tests can't move now(); this one can, so an hour that only
-- breaks late in the evening, or on a change day, breaks here every time.
--
-- Two instant-booking Services, 60 minutes each, on a 30-minute grid: A open
-- 9:00 to 17:00 with an hour's notice, B open all day with 90 minutes'. At
-- each instant, the slots for that Atlanta day and the next two must be
-- exactly the grid's: every wall-clock start that is open, ends by closing,
-- is a real time that day (none in March's skipped hour; November's
-- repeated hour once, its first, EDT: wall_clock_instant, itself checked in
-- service_availability 6h and 6i), and is at least the notice after now.
begin;
\ir _helpers/users.psql
select plan(6);

select tests.create_user('instants-a@test.local') as owner_a \gset
select tests.create_user('instants-b@test.local') as owner_b \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into categories (kind, name, slug) values ('service', 'Instant cuts', 'instant-cuts') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Instant Hill') returning id as area \gset
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'owner_a', 'Day Cuts', :'atl', 'acct_instants_a', true, true) returning id as pa \gset
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'owner_b', 'All Day Cuts', :'atl', 'acct_instants_b', true, true) returning id as pb \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'pa', 'service', :'svc', :'atl', 'A day cut', 'A cut during the day, by the instants test.', 4000, 60, 'provider_location', :'area', 'instant')
returning id as sa \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'pb', 'service', :'svc', :'atl', 'An any-hour cut', 'A cut at any hour, by the instants test.', 4000, 60, 'provider_location', :'area', 'instant')
returning id as sb \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'sa', :'sb');
update listings set status = 'live', published_at = now() where id in (:'sa', :'sb');
insert into provider_schedules (provider_id, slot_interval_minutes, min_notice_minutes, booking_window_days)
values (:'pa', 30, 60, 60), (:'pb', 30, 90, 60);
insert into provider_weekly_hours (provider_id, weekday, starts, ends)
select :'pa'::uuid, w, time '09:00', time '17:00' from generate_series(0, 6) w
union all
select :'pb'::uuid, w, time '00:00', time '24:00' from generate_series(0, 6) w;

-- The instants: every real hour of each day (25 in November's, 23 in
-- March's), at 5 past and 5 to.
create temp table instants as
select t from (values
    ('2026-10-21 04:00Z'::timestamptz, '2026-10-22 04:00Z'::timestamptz),  -- a Wednesday
    ('2026-10-24 04:00Z', '2026-10-25 04:00Z'),                            -- a Saturday
    ('2026-11-01 04:00Z', '2026-11-02 05:00Z'),                            -- November's change day
    ('2027-03-14 05:00Z', '2027-03-15 04:00Z')                             -- March's change day
  ) d(day_from, day_to),
  generate_series(day_from, day_to - interval '1 hour', interval '1 hour') h,
  unnest(array[h + interval '5 minutes', h + interval '55 minutes']) t;

-- The Services, their hours and notice, as the expected grid needs them.
create temp table services (listing uuid, opens time, closes interval, notice interval);
insert into services values (:'sa', '09:00', interval '17 hours', interval '60 minutes'), (:'sb', '00:00', interval '24 hours', interval '90 minutes');

-- What the slot core gives, at each instant: that Atlanta day and the next two.
create temp table got as
select i.t, s.listing, x.starts_at, x.ends_at
  from instants i cross join services s,
       lateral public.service_slots_at(s.listing, (i.t at time zone 'America/New_York')::date, (i.t at time zone 'America/New_York')::date + 2, i.t) x;

-- What it should give: the 30-minute wall-clock grid each day, open and
-- ending by closing, that is a real time that day, from now plus the notice.
create temp table want as
select i.t, s.listing, public.wall_clock_instant(g, 'America/New_York') as starts_at
  from instants i cross join services s,
       generate_series(0, 2) dd,
       lateral (select ((i.t at time zone 'America/New_York')::date + dd) as on_date) day,
       generate_series(day.on_date + s.opens, day.on_date + s.closes - interval '60 minutes', interval '30 minutes') g
 where public.wall_clock_instant(g, 'America/New_York') at time zone 'America/New_York' = g
   and public.wall_clock_instant(g, 'America/New_York') >= i.t + s.notice;

select is((select count(*)::int from instants), 192, '0. every real hour of the four days, at 5 past and 5 to');
select is((select count(*)::int from (select t, listing from got group by 1, 2) x), 384,
  '1. each Service has slots at every instant (so nothing below holds for want of any)');
select is_empty($$ select g.t, g.listing, g.starts_at from got g join services s using (listing) where g.starts_at < g.t + s.notice $$,
  '2. no slot starts before now plus the notice, at any hour');
select is_empty($$ select t, listing, starts_at from got where ends_at - starts_at <> interval '60 minutes' $$,
  '3. each slot lasts the Service''s 60 minutes, across the clock changes too');
select is_empty($$ select t, listing, starts_at from got group by 1, 2, 3 having count(*) > 1 $$,
  '4. no slot twice at one instant (the repeated hour once)');
select set_eq($$ select t, listing, starts_at from got $$, $$ select t, listing, starts_at from want $$,
  '5. at every hour, each Service''s slots are exactly the grid''s: open, real times, from now plus the notice');

select * from finish();
rollback;
