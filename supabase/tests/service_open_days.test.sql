-- Service availability, phase 4 (migration service_open_days; docs/design/
-- service-availability.md, "Search"): one slot core for one Service or many,
-- open days kept current by every change that moves slots, matches from the
-- table and live past it, and dates filtering and ordering Services.
begin;
\ir _helpers/users.psql
\ir _helpers/slots.psql
select plan(51);
-- This test is one transaction that never commits, so open days refresh at
-- the end of each statement here, as they would at each commit. Section 8
-- checks the deferral itself.
set constraints service_open_days_pending_refresh immediate;

-- The core as it was before this migration (20261015022506), word for word,
-- for the parity checks.
create function pg_temp.old_core(p_listing_id uuid, p_from date, p_to date, p_now timestamptz, p_require_bookable boolean)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_zone text;
  v_today date;
  v_window smallint;
  v_notice interval;
  v_step interval;
  v_duration interval;
  v_buffer interval;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'Ask for 1 to 31 days of times.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_listing from public.listings where id = p_listing_id;
  -- A Service with a mode and a duration has slots. For customers
  -- (p_require_bookable) it must also be live, with its provider, category
  -- and city active and its provider able to be paid; the provider's own
  -- preview skips that. Anything else has none (and says nothing about why).
  if v_listing.id is null or v_listing.kind <> 'service'
     or v_listing.booking_mode is null or v_listing.duration_minutes is null then
    return;
  end if;
  if p_require_bookable and (v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id)
     or not exists (select 1 from public.providers p where p.id = v_listing.provider_id
                     and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) = 'ready')) then
    return;
  end if;
  select c.timezone into v_zone from public.cities c where c.id = v_listing.city_id;
  select coalesce(s.booking_window_days, 60), make_interval(mins => coalesce(s.min_notice_minutes, 1440)),
         make_interval(mins => coalesce(s.slot_interval_minutes, 30))
    into v_window, v_notice, v_step
    from (select 1) one left join public.provider_schedules s on s.provider_id = v_listing.provider_id;
  -- Services the provider approves need at least 4 hours (time to answer,
  -- as create_service_booking requires), whatever the provider's notice.
  if v_listing.booking_mode = 'approve' then
    v_notice := greatest(v_notice, interval '4 hours');
  end if;
  v_today := (p_now at time zone v_zone)::date;
  v_duration := make_interval(mins => v_listing.duration_minutes);
  v_buffer := public.hold_buffer(v_listing);

  return query
  with days as (
    select d::date as day
      from generate_series(greatest(p_from, v_today)::timestamp, least(p_to, v_today + v_window)::timestamp, interval '1 day') d
  ),
  dated as (
    select dy.day, h.starts, h.ends
      from days dy join public.provider_date_hours h on h.provider_id = v_listing.provider_id and h.on_date = dy.day
  ),
  open as (
    select * from dated
    union all
    select dy.day, w.starts, w.ends
      from days dy join public.provider_weekly_hours w
        on w.provider_id = v_listing.provider_id and w.weekday = extract(dow from dy.day)
     where not exists (select 1 from dated where dated.day = dy.day)
  ),
  candidates as (
    -- Each start, as a wall-clock time turned into an instant in the
    -- market's zone (a time skipped by the March clock change lands an hour
    -- later, and is kept once), and the end of its interval.
    -- A time repeated in November is the first (daylight) one, written here
    -- independently of wall_clock_instant: an hour before Postgres's answer,
    -- when that still reads as the same wall-clock time (2026-10-18).
    select distinct (case when (((t at time zone v_zone) - interval '1 hour') at time zone v_zone) = t
                          then (t at time zone v_zone) - interval '1 hour' else t at time zone v_zone end) as slot_start,
           ((o.day + o.ends) at time zone v_zone) as open_until
      from open o
      cross join lateral generate_series(o.day + o.starts, o.day + o.ends - v_duration, v_step) t
     where not exists (select 1 from public.provider_time_off x
                        where x.provider_id = v_listing.provider_id and o.day between x.starts_on and x.ends_on)
  )
  select c.slot_start, c.slot_start + v_duration
    from candidates c
   where c.slot_start + v_duration <= c.open_until
     and c.slot_start >= p_now + v_notice
     and not exists (select 1 from public.provider_holds ph
                      where ph.provider_id = v_listing.provider_id
                        and ph.during && tstzrange(c.slot_start, c.slot_start + v_duration + v_buffer))
   order by 1;
end;
$$;


select tests.create_user('open-p@test.local') as up \gset
select tests.create_user('open-q@test.local') as uq \gset
select tests.create_user('open-r@test.local') as ur \gset
select tests.create_user('open-cust@test.local') as cust \gset
select tests.create_user('open-admin@test.local') as adm \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into categories (kind, name, slug) values ('service', 'Open cuts', 'open-cuts') returning id as svc \gset
insert into categories (kind, name, slug) values ('experience', 'Open walks', 'open-walks') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Open Ward') returning id as area \gset
insert into providers (owner_id, display_name, city_id) values (:'up', 'Open P', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'uq', 'Open Q', :'atl') returning id as q \gset
insert into providers (owner_id, display_name, city_id) values (:'ur', 'Open R', :'atl') returning id as r \gset
-- P: an hour's notice, a 15-minute buffer by default.
insert into provider_schedules (provider_id, min_notice_minutes, default_buffer_minutes) values (:'p', 60, 15);
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode) values
  (:'p', 'service', :'svc', :'atl', 'A cut', 'A Service made by the open-days test.', 4000, 60, 'provider_location', :'area', 'instant'),
  (:'p', 'service', :'svc', :'atl', 'B cut', 'A Service made by the open-days test.', 4000, 60, 'provider_location', :'area', 'approve'),
  (:'q', 'service', :'svc', :'atl', 'Q cut', 'A Service made by the open-days test.', 4000, 30, 'provider_location', :'area', 'instant'),
  (:'r', 'service', :'svc', :'atl', '0 R cut', 'A Service made by the open-days test.', 4000, 30, 'provider_location', :'area', 'instant');
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'P walk', 'An Experience made by the open-days test.', 3000, 60, :'area');
select id as s1 from listings where title = 'A cut' \gset
select id as s2 from listings where title = 'B cut' \gset
select id as s3 from listings where title = 'Q cut' \gset
select id as s4 from listings where title = '0 R cut' \gset
select id as walk from listings where title = 'P walk' \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where provider_id in (:'p', :'q', :'r');
update listings set status = 'live', published_at = now() where provider_id in (:'p', :'q', :'r');
select (now() at time zone 'America/New_York')::date as today \gset
select (:'today'::date + 3) as d \gset
-- P open all day every day; Q can be paid but has no hours; R open only
-- late on day d (11:00 PM to midnight in Atlanta: the next day in UTC).
select tests.make_bookable(:'p');
update providers set stripe_account_id = 'acct_test_openq', stripe_charges_enabled = true, stripe_payouts_enabled = true where id = :'q';
update providers set stripe_account_id = 'acct_test_openr', stripe_charges_enabled = true, stripe_payouts_enabled = true where id = :'r';
insert into provider_date_hours (provider_id, on_date, starts, ends) values (:'r', :'d', '23:00', '24:00');
-- P: other hours on d+1, a day off on d+2, a booking and a session to hold time.
insert into provider_date_hours (provider_id, on_date, starts, ends) values (:'p', :'d'::date + 1, '10:00', '12:00');
insert into provider_time_off (provider_id, starts_on, ends_on) values (:'p', :'d'::date + 2, :'d'::date + 2);
insert into experience_sessions (listing_id, starts_at, capacity)
values (:'walk', ((:'d'::date + 4) + time '10:00') at time zone 'America/New_York', 4);
select tests.authenticate_as_service_role();
select (create_service_booking(:'s1', :'cust', ((:'d'::date + 5) + time '09:00') at time zone 'America/New_York', 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id as b1 \gset
select tests.clear_authentication();

-- 1. One core: the same slots as before, for one Service or many.
create function pg_temp.diff(p_ids uuid[], p_from date, p_to date, p_bookable boolean) returns int language sql as $$
  select (select count(*) from (
            select l, s.starts_at, s.ends_at from unnest(p_ids) l, pg_temp.old_core(l, p_from, p_to, now(), p_bookable) s
            except select m.listing_id, m.starts_at, m.ends_at from public.service_slots_many(p_ids, p_from, p_to, now(), p_bookable) m) x)
       + (select count(*) from (
            select m.listing_id, m.starts_at, m.ends_at from public.service_slots_many(p_ids, p_from, p_to, now(), p_bookable) m
            except select l, s.starts_at, s.ends_at from unnest(p_ids) l, pg_temp.old_core(l, p_from, p_to, now(), p_bookable) s) x)::int $$;
select is(pg_temp.diff(array[:'s1', :'s2', :'s3', :'s4']::uuid[], :'today'::date, :'today'::date + 30, true), 0,
  '1a. the shared core gives exactly the old core''s slots (hours, date hours, time off, buffer, Approve notice, a booking, a session)');
select is(pg_temp.diff(array[:'s1', :'s2', :'s3', :'s4']::uuid[], :'today'::date + 31, :'today'::date + 61, true), 0,
  '1b. ...and past 31 days, up to the window''s end');
update listings set status = 'draft' where id = :'s2';
select is(pg_temp.diff(array[:'s1', :'s2']::uuid[], :'today'::date, :'today'::date + 30, false), 0,
  '1c. ...and for the provider''s preview (a draft included)');
update listings set status = 'live' where id = :'s2';
select ok((select count(*) from service_slots_many(array[:'s1']::uuid[], :'today'::date, :'today'::date + 30, now(), true)) > 0,
  '1d. (the fixture has slots to compare)');

-- 2. Open days: each day with a time, its first and last, by Atlanta day.
select is((select array_agg(on_date order by on_date) from service_open_days where listing_id = :'s1' and on_date <= :'today'::date + 30),
  (select array_agg(distinct (s.starts_at at time zone 'America/New_York')::date order by (s.starts_at at time zone 'America/New_York')::date)
     from service_slots(:'s1', :'today'::date, :'today'::date + 30) s),
  '2a. a Service''s open days are exactly the days service_slots has times');
select is((select first_at from service_open_days where listing_id = :'s1' and on_date = :'d'::date + 1),
  ((:'d'::date + 1) + time '10:00') at time zone 'America/New_York', '2b. a day''s first time (its date hours)');
select ok(not exists (select 1 from service_open_days where listing_id = :'s1' and on_date = :'d'::date + 2), '2c. no open day on time off');
select is((select array_agg(on_date) from service_open_days where listing_id = :'s4'), array[:'d'::date],
  '2d. 11:00 PM in Atlanta is that Atlanta day, though it''s the next day in UTC');
select ok(not exists (select 1 from service_open_days where listing_id = :'s3'), '2e. no hours: no open days');
select is((select notice from service_open_days_refreshed where listing_id = :'s2'), interval '4 hours',
  '2f. an Approve Service''s notice is at least 4 hours');
select is((select covered_through from service_open_days_refreshed where listing_id = :'s1'), :'today'::date + 60,
  '2g. covered through today plus the window');

-- 3. Kept current by every change that moves slots.
select first_at as before_first from service_open_days where listing_id = :'s1' and on_date = :'d' \gset
select tests.authenticate_as_service_role();
select (create_service_booking(:'s1', :'cust', :'before_first'::timestamptz, 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id as b2 \gset
select tests.clear_authentication();
select is((select first_at from service_open_days where listing_id = :'s1' and on_date = :'d'), :'before_first'::timestamptz + interval '90 minutes',
  '3a. a booking takes its time (and buffer) off the day at once');
select is((select first_at from service_open_days where listing_id = :'s2' and on_date = :'d'), :'before_first'::timestamptz + interval '90 minutes',
  '3b. ...for the provider''s other Services too');
update bookings set status = 'expired', status_changed_by = 'system' where id = :'b2';
select is((select first_at from service_open_days where listing_id = :'s1' and on_date = :'d'), :'before_first'::timestamptz,
  '3c. an expired booking gives its time back');
insert into provider_time_off (provider_id, starts_on, ends_on) values (:'p', :'d', :'d');
select ok(not exists (select 1 from service_open_days where listing_id = :'s1' and on_date = :'d'), '3d. time off closes the day');
delete from provider_time_off where provider_id = :'p' and starts_on = :'d';
select ok(exists (select 1 from service_open_days where listing_id = :'s1' and on_date = :'d'), '3e. ...and deleting it opens it again');
insert into provider_weekly_hours (provider_id, weekday, starts, ends) select :'q', w, '09:00', '17:00' from generate_series(0, 6) w;
select ok(exists (select 1 from service_open_days where listing_id = :'s3'), '3f. hours added: open days appear');
delete from provider_weekly_hours where provider_id = :'q';
select ok(not exists (select 1 from service_open_days where listing_id = :'s3'), '3g. ...and go with them');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'walk', ((:'d'::date + 1) + time '10:00') at time zone 'America/New_York', 4);
select ok(not exists (select 1 from service_open_days where listing_id = :'s1' and on_date = :'d'::date + 1),
  '3h. a session holds its time too (with the buffer, nothing is left of that short day)');
insert into provider_date_hours (provider_id, on_date, starts, ends) values (:'p', :'d'::date + 6, '10:00', '11:30');
select ok(exists (select 1 from service_open_days where listing_id = :'s1' and on_date = :'d'::date + 6), '3i. an hour and a half fits an hour');
update listings set duration_minutes = 120 where id = :'s1';
select ok(not exists (select 1 from service_open_days where listing_id = :'s1' and on_date = :'d'::date + 6),
  '3j. a longer duration: a day too short for it closes');
update listings set booking_mode = 'approve' where id = :'s1';
select is((select notice from service_open_days_refreshed where listing_id = :'s1'), interval '4 hours', '3k. a mode change refreshes the notice');
update provider_schedules set min_notice_minutes = 480 where provider_id = :'p';
select is((select notice from service_open_days_refreshed where listing_id = :'s1'), interval '8 hours', '3l. ...and so does a settings change');
update listings set status = 'unpublished', unpublished_reason = 'Taken down by the open-days test.' where id = :'s2';
select ok(not exists (select 1 from service_open_days where listing_id = :'s2'), '3m. a Service taken down has no open days');
update providers set stripe_payouts_enabled = false where id = :'r';
select ok(not exists (select 1 from service_open_days where listing_id = :'s4'), '3n. a provider who can''t be paid: none');
update providers set stripe_payouts_enabled = true where id = :'r';

-- 4. Matches: from the table, and live past it.
select tests.authenticate_as_anon();
select is((select array_agg(listing_id order by listing_id) from service_open_matches(array[:'s1', :'s3', :'s4']::uuid[], :'d', :'d')),
  (select array_agg(id order by id) from unnest(array[:'s1', :'s4']::uuid[]) id), '4a. the Services with a time that day; not one with no hours');
select is((select first_day from service_open_matches(array[:'s1']::uuid[], :'d'::date + 2, :'d'::date + 5)), :'d'::date + 3,
  '4b. its first day in the range with a time (not the day off)');
select tests.clear_authentication();
-- As if the daily job hadn't run for weeks: the table covers nothing ahead.
update service_open_days_refreshed set covered_through = :'today'::date - 1 where listing_id = :'s1';
delete from service_open_days where listing_id = :'s1';
select tests.authenticate_as_anon();
select is((select first_day from service_open_matches(array[:'s1']::uuid[], :'d'::date + 2, :'d'::date + 5)), :'d'::date + 3,
  '4c. past what the table covers, the same core works it out live');
select tests.clear_authentication();
delete from service_open_days_refreshed where listing_id = :'s1';
select tests.authenticate_as_anon();
select is((select count(*)::int from service_open_matches(array[:'s1']::uuid[], :'d'::date + 3, :'d'::date + 3)), 1,
  '4d. ...and for a Service never worked out');
select tests.clear_authentication();
-- A day whose last time has come within the notice no longer matches.
update service_open_days set first_at = now(), last_at = now() where listing_id = :'s4';
select tests.authenticate_as_anon();
select is((select count(*)::int from service_open_matches(array[:'s4']::uuid[], :'d', :'d')), 0, '4e. a day whose times are all within the notice now: no match');
select throws_ok(format($$ select * from service_open_matches(array[%L]::uuid[], %L::date, %L::date + 201) $$, :'s4', :'today', :'today'),
  '22023', 'Ask for at most 200 days.', '4f. at most 200 days');

-- 5. Browse: dates filter and order Services.
select tests.clear_authentication();
select public.refresh_service_open_days(array[:'p', :'q', :'r']::uuid[]);
update listings set booking_mode = 'instant', duration_minutes = 60, status = 'live', unpublished_reason = null where id in (:'s1', :'s2');
update provider_schedules set min_notice_minutes = 60 where provider_id = :'p';
create function pg_temp.ids(j jsonb) returns text[] language sql as $$ select array(select jsonb_array_elements_text(j -> 'ids')) $$;
grant execute on function pg_temp.ids(jsonb) to anon;
select tests.authenticate_as_anon();
select is(pg_temp.ids(public_browse('atlanta', 'service', 'open-cuts', null,
            :'d'::date::timestamp at time zone 'America/New_York', (:'d'::date + 1)::timestamp at time zone 'America/New_York')),
  array[:'s1', :'s2', :'s4']::text[], '5a. dated: soonest free time first (P from midnight, R from 11 PM, though R''s title comes first), then title; Q (no hours) not at all');
select is(public_browse('atlanta', 'service', 'open-cuts', null,
            (:'d'::date + 2)::timestamp at time zone 'America/New_York', (:'d'::date + 4)::timestamp at time zone 'America/New_York') -> 'firstDays' ->> :'s1',
  (:'d'::date + 3)::text, '5b. each Service''s first free day in the range, for the panel');
select is((pg_temp.ids(public_browse('atlanta', 'service', 'open-cuts')))[4], :'s3'::text, '5c. undated: a Service with no free time comes last');
select is(public_browse('atlanta', 'service', 'open-cuts') -> 'closed', jsonb_build_array(:'s3'), '5d. ...marked as not taking bookings');

-- 6. Who may do what.
select throws_ok('select * from service_open_days', '42501', null, '6a. visitors can''t read open days directly');
select tests.authenticate_as(:'up');
select is((select count(*)::int from service_open_days), 0, '6b. nor can a provider (only through search)');
select throws_ok(format($$ select public.refresh_service_open_days(array[%L]::uuid[]) $$, :'p'), '42501', null, '6c. nor refresh them');
select tests.authenticate_as_admin(:'adm');
select ok((select count(*) from service_open_days) > 0, '6d. admins read them');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.service_slots_many(uuid[],date,date,timestamptz,boolean)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.service_slots_many(uuid[],date,date,timestamptz,boolean)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.service_slots_many(uuid[],date,date,timestamptz,boolean)', 'EXECUTE'),
  '6e. the core itself is the functions'' own');

-- 7. The daily job: the oldest first, a batch at a time.
update service_open_days_refreshed set refreshed_at = now() - interval '2 days' where provider_id in (:'p', :'r');
update service_open_days_refreshed set refreshed_at = now() - interval '3 days' where provider_id = :'r';
select tests.authenticate_as_service_role();
select is(refresh_stale_service_open_days(1), '{"refreshed": 1, "more_waiting": true}'::jsonb, '7a. a full batch says more are waiting');
select tests.clear_authentication();
select ok((select bool_and(refreshed_at = now()) from service_open_days_refreshed where provider_id = :'r')
      and (select bool_and(refreshed_at < now()) from service_open_days_refreshed where provider_id = :'p'), '7b. ...and took the oldest first');
select tests.authenticate_as_service_role();
select is(refresh_stale_service_open_days(1), '{"refreshed": 1, "more_waiting": false}'::jsonb, '7c. the next run takes the rest');
select tests.authenticate_as(:'up');
select throws_ok('select refresh_stale_service_open_days(50)', '42501', null, '7d. only the server runs it');
select tests.clear_authentication();

-- 8. A weekly series of 52 sessions in one save: one refresh, at commit.
set constraints service_open_days_pending_refresh deferred;
set local track_functions = 'all';
select coalesce((select calls from pg_stat_xact_user_functions where funcname = 'refresh_service_open_days'), 0) as calls0 \gset
insert into experience_sessions (listing_id, starts_at, capacity)
select :'walk', (((:'today'::date + 20 + 7 * w) + time '18:00') at time zone 'America/New_York'), 6 from generate_series(0, 51) w;
select is((select count(*)::int from provider_holds h join experience_sessions x on x.id = h.session_id where x.listing_id = :'walk' and x.starts_at > now() + interval '19 days'), 52,
  '8a. (52 sessions, each holding its time: 52 hold statements)');
select is((select count(*)::int from service_open_days_pending where provider_id = :'p'), 1, '8b. the provider is noted once');
select is(coalesce((select calls from pg_stat_xact_user_functions where funcname = 'refresh_service_open_days'), 0) - :calls0, 0::bigint,
  '8c. nothing is refreshed before the transaction ends');
-- (What commit does: the deferred trigger fires.)
set constraints service_open_days_pending_refresh immediate;
select is(coalesce((select calls from pg_stat_xact_user_functions where funcname = 'refresh_service_open_days'), 0) - :calls0, 1::bigint,
  '8d. at commit, one refresh for the whole series');
select ok(not exists (select 1 from service_open_days_pending), '8e. ...and nothing is left pending');

-- 9. A provider with hours and holds can still be deleted (the cascade's
-- notes for a refresh don't stop it), and nothing is left pending.
select tests.create_user('open-gone@test.local') as ug \gset
insert into providers (owner_id, display_name, city_id) values (:'ug', 'Open Gone', :'atl') returning id as g \gset
insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (:'g', 1, '09:00', '17:00');
insert into provider_time_off (provider_id, starts_on, ends_on) values (:'g', :'d', :'d');
select lives_ok(format($$ delete from providers where id = %L $$, :'g'), '9a. a provider with hours and time off can be deleted');
select ok(not exists (select 1 from service_open_days_pending), '9b. ...and nothing is left pending');

select * from finish();
rollback;
