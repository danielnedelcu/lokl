-- Service availability, phase 1 (docs/design/service-availability.md):
-- providers' schedules and who can read and write them; the slots a
-- Service offers; booking a slot (both modes) and the guard's new rules;
-- holds, so a provider is never double booked across their listings; and
-- who may call the new functions.
begin;
\ir _helpers/users.psql
select plan(73);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('slots-provider@test.local') as owner \gset
select tests.create_user('slots-other@test.local') as other_owner \gset
select tests.create_user('slots-customer@test.local') as cust \gset
select tests.create_user('slots-customer2@test.local') as cust2 \gset
select tests.create_user('slots-admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Cuts and Walks', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'other_owner', 'Other Studio', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('experience', 'Walks', 'slot-walks') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'slot-hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Slot Ward') returning id as area \gset

-- A 60-minute studio Service, a 150-minute Experience, and the other
-- provider's 60-minute Service.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 60, 'provider_location', :'area', 'approve')
returning id as ls \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'Neighbourhood walk', 'A walk around the neighbourhood, with stories.', 3000, 150, :'area')
returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p2', 'service', :'svc', :'atl', 'Another studio cut', 'Another classic cut, with a wash.', 4000, 60, 'provider_location', :'area', 'approve')
returning id as ls2 \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'ls', :'le', :'ls2');
update listings set status = 'live', published_at = now() where id in (:'ls', :'le', :'ls2');
-- Both providers can be paid (Stripe set up).
update providers set stripe_account_id = 'acct_' || left(replace(id::text, '-', ''), 16), stripe_charges_enabled = true, stripe_payouts_enabled = true
 where id in (:'p', :'p2');

-- The day the tests book: five days ahead in Atlanta, past the 24-hour notice.
select (now() at time zone 'America/New_York')::date + 5 as d \gset
select extract(dow from :'d'::date)::int as dow \gset
-- An Atlanta wall-clock time on that day, as an instant.
create function pg_temp.at(p_time text) returns timestamptz language sql stable
  as $$ select ((current_setting('tests.d')::date + p_time::time) at time zone 'America/New_York') $$;
select set_config('tests.d', :'d', true);
grant execute on function pg_temp.at(text) to anon, authenticated, service_role;
create function pg_temp.slots(p_listing uuid) returns int language sql stable
  as $$ select count(*)::int from public.service_slots(p_listing, current_setting('tests.d')::date, current_setting('tests.d')::date) $$;
grant execute on function pg_temp.slots(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. SCHEDULES: providers write their own; nobody else's
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into provider_weekly_hours (provider_id, weekday, starts, ends)
  select %L, w, '09:00', '17:00' from generate_series(0, 6) w $$, :'p'), '1a. a provider sets their own weekly hours');
select throws_ok(format($$ insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (%L, 1, '09:00', '17:00') $$, :'p2'),
  '42501', 'new row violates row-level security policy for table "provider_weekly_hours"', '1b. ...but not another provider''s');
select throws_ok(format($$ insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (%L, %s, '16:00', '18:00') $$, :'p', :dow),
  '23P01', null, '1c. two intervals on one day can''t overlap');
select lives_ok(format($$ insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (%L, %s, '17:00', '18:00') $$, :'p', :dow),
  '1d. ...but can touch');
delete from provider_weekly_hours where weekday = :dow and starts = '17:00';
select throws_ok(format($$ insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (%L, 1, '17:00', '09:00') $$, :'p'),
  '23514', null, '1e. an interval ends after it starts');
select lives_ok(format($$ insert into provider_schedules (provider_id) values (%L) $$, :'p'), '1f. a provider saves their booking settings');
select throws_ok(format($$ update provider_schedules set provider_id = %L $$, :'p2'),
  '42501', 'permission denied for table provider_schedules', '1g. ...and can''t give them to another provider');

select tests.authenticate_as(:'other_owner');
select is((select count(*)::int from provider_weekly_hours), 0, '1h. another provider sees none of them');
select lives_ok($$ delete from provider_weekly_hours $$, '1i. ...and deleting them...');
select tests.clear_authentication();
select is((select count(*)::int from provider_weekly_hours where provider_id = :'p'), 7, '1j. ...deletes nothing');

select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from provider_weekly_hours where provider_id = :'p'), 7, '1k. admins read every provider''s hours');
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from provider_weekly_hours $$, '42501', 'permission denied for table provider_weekly_hours',
  '1l. visitors read no schedules');

-- ---------------------------------------------------------------------------
-- 2. SLOTS
-- ---------------------------------------------------------------------------

-- No mode yet: no slots, even with hours.
select is(pg_temp.slots(:'ls'), 15, '2a. a live Service with a mode and hours has slots (every Service has a mode since phase 2)');
select tests.authenticate_as(:'owner');
select lives_ok(format($$ update listings set booking_mode = 'approve' where id = %L $$, :'ls'), '2b. the provider sets its mode');
select throws_ok(format($$ update listings set booking_mode = 'instant' where id = %L $$, :'le'),
  '23514', null, '2c. an Experience has no booking mode');

select tests.authenticate_as_anon();
select is(pg_temp.slots(:'ls'), 15, '2d. visitors see the slots: 9:00 to 16:00, every 30 minutes, for 60 minutes');
select is((select min(starts_at) from service_slots(:'ls', :'d', :'d')), pg_temp.at('09:00'), '2e. the first at 9:00 Atlanta time');
select is((select max(ends_at) from service_slots(:'ls', :'d', :'d')), pg_temp.at('17:00'), '2f. the last ends at 17:00');
select is(pg_temp.slots(:'ls2'), 0, '2g. a provider without hours has no slots');
select tests.clear_authentication();
update providers set stripe_payouts_enabled = false where id = :'p';
select is(pg_temp.slots(:'ls'), 0, '2g2. a provider who can''t be paid yet (payouts not set up) has no slots');
update providers set stripe_payouts_enabled = true where id = :'p';
select tests.authenticate_as_anon();
select throws_ok(format($$ select * from service_slots(%L, %L::date, %L::date + 31) $$, :'ls', :'d', :'d'),
  '22023', 'Ask for 1 to 31 days of times.', '2h. at most 31 days at a time');

select tests.clear_authentication();
update provider_schedules set slot_interval_minutes = 60 where provider_id = :'p';
select is(pg_temp.slots(:'ls'), 8, '2i. every 60 minutes: 8 slots');
update provider_schedules set slot_interval_minutes = 30 where provider_id = :'p';
insert into provider_date_hours (provider_id, on_date, starts, ends) values (:'p', :'d', '10:00', '12:00');
select is(pg_temp.slots(:'ls'), 3, '2j. hours for the date replace the weekly hours: 10:00, 10:30, 11:00');
delete from provider_date_hours where provider_id = :'p';
insert into provider_time_off (provider_id, starts_on, ends_on) values (:'p', :'d'::date - 1, :'d') returning id as off \gset
select is(pg_temp.slots(:'ls'), 0, '2k. time off: none');
delete from provider_time_off where id = :'off';
update provider_schedules set min_notice_minutes = 10080 where provider_id = :'p';
select is(pg_temp.slots(:'ls'), 0, '2l. a week''s notice: none five days ahead');
update provider_schedules set min_notice_minutes = 1440, booking_window_days = 7 where provider_id = :'p';
select is((select count(*)::int from service_slots(:'ls', :'d'::date + 3, :'d'::date + 3)), 0, '2m. a 7-day window: none eight days ahead');
update provider_schedules set booking_window_days = 60 where provider_id = :'p';

-- An Experience session (12:00 to 14:30) blocks the Services that would overlap it.
select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 4) $$, :'le', pg_temp.at('12:00')),
  '2n. the provider schedules a session');
select tests.clear_authentication();
select is(pg_temp.slots(:'ls'), 9, '2o. ...which takes 11:30 to 14:00 out of the Service''s slots');
update listings set buffer_minutes = 30 where id = :'ls';
select is(pg_temp.slots(:'ls'), 8, '2p. with a 30-minute buffer after each booking, 11:00 goes too (it would end 12:00, then 30 minutes'' travel)');
update listings set buffer_minutes = null where id = :'ls';

-- ---------------------------------------------------------------------------
-- 3. BOOKING A SLOT
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select (create_service_booking(:'ls', :'cust', pg_temp.at('09:00'), 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id as b1 \gset
select is((select array[status, service_mode] from bookings where id = :'b1'), array['pending_payment', 'approve'], '3a. a slot is booked, pending payment, in the listing''s mode');
select is((select array[starts_at, ends_at] from bookings where id = :'b1'), array[pg_temp.at('09:00'), pg_temp.at('10:00')], '3b. its start and end are set now');
select is((select during from provider_holds where booking_id = :'b1'), tstzrange(pg_temp.at('09:00'), pg_temp.at('10:00')), '3c. it holds 9:00 to 10:00');
select is(pg_temp.slots(:'ls'), 7, '3d. 9:00 and 9:30 (which would overlap it) are no longer offered');
select throws_ok(format($$ select create_service_booking(%L, %L, %L, 'Jo', 'jo@test.local', null, null, null, now() + interval '30 minutes') $$, :'ls', :'cust2', pg_temp.at('09:00')),
  '23514', 'That time isn''t available. Pick another.', '3e. the same slot can''t be booked again');
select throws_ok(format($$ select create_service_booking(%L, %L, %L, 'Jo', 'jo@test.local', null, null, null, now() + interval '30 minutes') $$, :'ls', :'cust2', pg_temp.at('10:10')),
  '23514', 'That time isn''t available. Pick another.', '3f. a time that isn''t a slot is refused');
-- Two customers at once: both pass the slot check; the hold refuses the second.
select tests.clear_authentication();
select throws_ok(format($$ update provider_holds set during = tstzrange(%L, %L)
  where session_id = (select id from experience_sessions where listing_id = %L) $$, pg_temp.at('09:30'), pg_temp.at('10:30'), :'le'),
  '23P01', null, '3g. no two holds of a provider can overlap');

-- Approval: requested, answered at least 2 hours before the start.
select tests.authenticate_as_service_role();
select lives_ok(format($$ update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id = %L $$, :'b1'),
  '3i. an approval booking is requested once paid');
select is((select respond_by from bookings where id = :'b1'), least(now() + interval '48 hours', pg_temp.at('07:00')), '3j. ...answered by 48 hours, or 2 hours before it starts if sooner');
select throws_ok(format($$ update bookings set status = 'confirmed', starts_at = %L, status_changed_by = 'provider' where id = %L $$, pg_temp.at('11:00'), :'b1'),
  '23514', 'A booked time can''t be changed.', '3k. the provider accepts the slot, not another time');
select lives_ok(format($$ update bookings set status = 'confirmed', status_changed_by = 'provider' where id = %L $$, :'b1'), '3l. the provider accepts');
select is((select array[ends_at, payout_due_at] from bookings where id = :'b1'), array[pg_temp.at('10:00'), pg_temp.at('10:00') + interval '24 hours'],
  '3m. its end stays as booked; paid out 24 hours after');

-- Instant: confirmed when paid, never requested.
select tests.clear_authentication();
update listings set booking_mode = 'instant' where id = :'ls';
select tests.authenticate_as_service_role();
select (create_service_booking(:'ls', :'cust2', pg_temp.at('15:00'), 'Jo', 'jo@test.local', null, null, null, now() + interval '30 minutes')).id as b2 \gset
select throws_ok(format($$ update bookings set status = 'requested', status_changed_by = 'stripe' where id = %L $$, :'b2'),
  '23514', 'An instant booking is confirmed when it''s paid, not requested.', '3n. an instant booking isn''t requested');
select lives_ok(format($$ update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = %L $$, :'b2'), '3o. ...it''s confirmed when paid');

-- Released: the slot is offered again.
select is(pg_temp.slots(:'ls'), 4, '3p. booked 9:00 and 15:00, and the session 12:00 to 14:30: 10:00, 10:30, 11:00 and 16:00 left');
select lives_ok(format($$ update bookings set status = 'cancelled', status_changed_by = 'customer', cancelled_by = 'customer', refunded_cents = total_cents where id = %L $$, :'b2'),
  '3q. the 15:00 booking is cancelled (refunded)');
select is((select count(*)::int from provider_holds where booking_id = :'b2'), 0, '3r. ...its hold is released');
select is(pg_temp.slots(:'ls'), 7, '3s. ...and 14:30 to 15:30 are offered again');

-- Approval needs 4 hours' notice.
select tests.clear_authentication();
update listings set booking_mode = 'approve' where id = :'ls';
update provider_schedules set min_notice_minutes = 60 where provider_id = :'p';
insert into provider_date_hours (provider_id, on_date, starts, ends)
values (:'p', (now() at time zone 'America/New_York')::date, '00:00', '24:00'), (:'p', (now() at time zone 'America/New_York')::date + 1, '00:00', '24:00');
select tests.authenticate_as_service_role();
-- (service_slots no longer offers it, since phase 2; the booking function
-- refuses it anyway.)
select throws_ok(format($$ select create_service_booking(%L, %L, date_trunc('hour', now()) + interval '2 hours',
    'Jo', 'jo@test.local', null, null, null, now() + interval '30 minutes') $$, :'ls', :'cust2'),
  '23514', 'This Service needs at least 4 hours'' notice, so the provider has time to answer.', '3t. an approval booking less than 4 hours ahead is refused');

-- ---------------------------------------------------------------------------
-- 4. SESSIONS AND BOOKINGS SHARE THE PROVIDER'S TIME
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 4) $$, :'le', pg_temp.at('08:00')),
  '23P01', 'That time overlaps another of your bookings or sessions.', '4a. a session over a booked Service is refused');
select lives_ok(format($$ update experience_sessions set starts_at = %L where listing_id = %L $$, pg_temp.at('15:00'), :'le'),
  '4b. a session moves to free time');
select tests.clear_authentication();
select is((select during from provider_holds h join experience_sessions s on s.id = h.session_id where s.listing_id = :'le'),
  tstzrange(pg_temp.at('15:00'), pg_temp.at('17:30')), '4c. ...and its hold moves with it (150 minutes)');
select tests.authenticate_as(:'owner');
select lives_ok(format($$ update experience_sessions set status = 'cancelled' where listing_id = %L $$, :'le'), '4d. cancelling the session...');
select tests.clear_authentication();
select is((select count(*)::int from provider_holds h join experience_sessions s on s.id = h.session_id where s.listing_id = :'le'), 0,
  '4e. ...releases its time');

-- ---------------------------------------------------------------------------
-- 5. WHO MAY CALL WHAT
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'owner');
select is((select count(*)::int from provider_holds), 0, '5a. providers read no holds (their bookings and sessions show their time)');
select tests.authenticate_as_admin(:'admin');
select ok((select count(*)::int from provider_holds where provider_id = :'p') > 0, '5a2. admins read holds');
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from provider_holds $$, '42501', 'permission denied for table provider_holds', '5a3. visitors can''t');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.create_service_booking(uuid,uuid,timestamptz,text,text,text,text,jsonb,timestamptz,uuid,text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.create_service_booking(uuid,uuid,timestamptz,text,text,text,text,jsonb,timestamptz,uuid,text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.create_service_booking(uuid,uuid,timestamptz,text,text,text,text,jsonb,timestamptz,uuid,text)', 'EXECUTE'),
  '5b. create_service_booking(): only the server');
-- btree_gist's functions: only inside the indexes; no API role can call them.
select ok(not has_schema_privilege('anon', 'gist_support', 'USAGE') and not has_schema_privilege('authenticated', 'gist_support', 'USAGE')
      and not has_schema_privilege('service_role', 'gist_support', 'USAGE'),
  '5c. no API role can use btree_gist''s schema');
select tests.authenticate_as_anon();
select throws_ok($$ select gist_support.int2_dist(1::smallint, 2::smallint) $$, '42501', 'permission denied for schema gist_support',
  '5d. ...a visitor calling one of its functions is refused');
select tests.authenticate_as(:'owner');
select throws_ok($$ select gist_support.int2_dist(1::smallint, 2::smallint) $$, '42501', 'permission denied for schema gist_support',
  '5e. ...and a signed-in user');
select tests.authenticate_as_service_role();
select throws_ok($$ select gist_support.int2_dist(1::smallint, 2::smallint) $$, '42501', 'permission denied for schema gist_support',
  '5f. ...and the server');


-- The locked schema doesn't get in the way of the real roles: the indexes
-- that use btree_gist work for each of them.
select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into provider_weekly_hours (provider_id, weekday, starts, ends) values (%L, %s, '18:00', '19:00') $$, :'p', :dow),
  '5g. with gist_support locked, a provider still adds hours (as a signed-in user)');
select lives_ok(format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 4) $$, :'le', pg_temp.at('20:00')),
  '5h. ...schedules a session');
select tests.authenticate_as_service_role();
select lives_ok(format($$ select create_service_booking(%L, %L, %L, 'Kim', 'kim@test.local', null, null, null, now() + interval '30 minutes') $$,
  :'ls', :'cust2', pg_temp.at('16:00')),
  '5i. ...and the server books a slot (as the service role)');

-- ---------------------------------------------------------------------------
-- 6. THE CLOCK CHANGES (service_slots_at, as of a time before each)
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.service_slots_at(uuid,date,date,timestamptz)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.service_slots_at(uuid,date,date,timestamptz)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.service_slots_at(uuid,date,date,timestamptz)', 'EXECUTE'),
  '6a. service_slots_at(): only the server');
-- On the second provider, which has no hours or bookings of its own: the
-- first one's hours for today and tomorrow, and its bookings five days
-- ahead, would overlap the change days when the test runs near them
-- (found 2026-10-19: on October 31 and November 1 the hours below were
-- refused, and on October 27 a 9:00 booking held 6e's slot).
insert into provider_schedules (provider_id, slot_interval_minutes, min_notice_minutes, booking_window_days)
values (:'p2', 30, 1440, 60);
-- Each change day: the night (00:00 to 05:00) and the day (9:00 to 17:00).
insert into provider_date_hours (provider_id, on_date, starts, ends) values
  (:'p2', '2027-03-14', '00:00', '05:00'), (:'p2', '2027-03-14', '09:00', '17:00'),
  (:'p2', '2026-11-01', '00:00', '04:00'), (:'p2', '2026-11-01', '09:00', '17:00');
create function pg_temp.local_starts(p_listing uuid, p_day date, p_now timestamptz) returns text[] language sql stable as $$
  select array_agg(to_char(starts_at at time zone 'America/New_York', 'HH24:MI') order by starts_at)
    from public.service_slots_at(p_listing, p_day, p_day, p_now) $$;
grant execute on function pg_temp.local_starts(uuid, date, timestamptz) to service_role;
select tests.authenticate_as_service_role();

-- March 14, 2027: 2:00 to 3:00 doesn't happen.
select ok('09:00' = any (pg_temp.local_starts(:'ls2', '2027-03-14', '2027-03-12 12:00-05')),
  '6b. March change day: hours from 9:00 still give a 9:00 AM slot');
select is((pg_temp.local_starts(:'ls2', '2027-03-14', '2027-03-12 12:00-05'))[1:7],
  array['00:00', '00:30', '01:00', '01:30', '03:00', '03:30', '04:00'],
  '6c. ...and the skipped hour gives no phantom slot: 1:30, then 3:00');
select is((select count(*)::int from service_slots_at(:'ls2', '2027-03-14', '2027-03-14', '2027-03-12 12:00-05')),
  (select count(distinct starts_at)::int from service_slots_at(:'ls2', '2027-03-14', '2027-03-14', '2027-03-12 12:00-05')),
  '6d. ...each slot is a different moment');
-- November 1, 2026: 1:00 to 2:00 happens twice.
select ok('09:00' = any (pg_temp.local_starts(:'ls2', '2026-11-01', '2026-10-30 12:00-04')),
  '6e. November change day: hours from 9:00 still give a 9:00 AM slot');
select is((pg_temp.local_starts(:'ls2', '2026-11-01', '2026-10-30 12:00-04'))[1:7],
  array['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00'],
  '6f. ...and the repeated hour offers each time once: 1:00 and 1:30 once each');
select is((select count(*)::int from service_slots_at(:'ls2', '2026-11-01', '2026-11-01', '2026-10-30 12:00-04')),
  (select count(distinct starts_at)::int from service_slots_at(:'ls2', '2026-11-01', '2026-11-01', '2026-10-30 12:00-04')),
  '6g. ...each slot is a different moment');
-- Which 1:00 is offered: the first, still daylight time (EDT, UTC-4), as
-- the design says (docs/design/service-availability.md); never the repeated
-- one in standard time (EST, UTC-5).
select is((select array_agg(starts_at order by starts_at) from service_slots_at(:'ls2', '2026-11-01', '2026-11-01', '2026-10-30 12:00-04')
            where starts_at in ('2026-11-01 01:00-04', '2026-11-01 01:00-05', '2026-11-01 01:30-04', '2026-11-01 01:30-05')),
  array['2026-11-01 01:00-04', '2026-11-01 01:30-04']::timestamptz[],
  '6h. the repeated hour''s 1:00 and 1:30 are the first ones (EDT), not the repeated ones (EST)');
select ok(not exists (select 1 from service_slots_at(:'ls2', '2026-11-01', '2026-11-01', '2026-10-30 12:00-04')
            where starts_at >= '2026-11-01 01:00-05' and starts_at < '2026-11-01 02:00-05'),
  '6i. ...and no slot starts in the repeated (EST) hour');

select * from finish();
rollback;
