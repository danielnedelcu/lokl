-- Service availability, phase 3 (docs/design/service-availability.md):
-- Services are booked from slots only. The old request flow is gone
-- (create_service_request, bookings.preferred_times); every Service booking
-- has its mode, start and end, and an Experience booking has no mode; the
-- server's view works without the old column; every booking trigger is on.
-- service_next_slot finds the first time anywhere in the booking window.
begin;
\ir _helpers/users.psql
\ir _helpers/slots.psql
select plan(16);

select tests.create_user('slots-only-owner@test.local') as owner \gset
select tests.create_user('slots-only-customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Slots Only Studio', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'slots-only-hair') returning id as svc \gset
insert into categories (kind, name, slug) values ('experience', 'Walks', 'slots-only-walks') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Slots Only Ward') returning id as area \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p', 'service', :'svc', :'atl', 'Slots only haircut', 'A classic cut, with a wash and style.', 4500, 60, 'provider_location', :'area', 'approve') returning id as ls \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'Slots only walk', 'A walk around the neighbourhood, with stories.', 3000, 60, :'area') returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'ls', :'le');
select tests.make_ready(id) from listings where id in (:'ls', :'le');
update listings set status = 'live', published_at = now() where id in (:'ls', :'le');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '10 days', 4) returning id as s1 \gset
select tests.make_bookable(:'p');
-- A second provider, able to be paid, with no hours yet.
select tests.create_user('slots-only-owner2@test.local') as owner2 \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Slots Only Two', :'atl') returning id as p2 \gset
update providers set stripe_account_id = 'acct_test_slotsonly2', stripe_charges_enabled = true, stripe_payouts_enabled = true where id = :'p2';
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p2', 'service', :'svc', :'atl', 'Slots only beard trim', 'A beard trim and hot towel, start to finish.', 2500, 60, 'provider_location', :'area', 'instant') returning id as ls2 \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id = :'ls2';
select tests.make_ready(:'ls2');
update listings set status = 'live', published_at = now() where id = :'ls2';
select (now() at time zone 'America/New_York')::date as today \gset

-- 1. The old flow is gone.
select ok(not exists (select 1 from pg_proc where proname = 'create_service_request'), '1a. create_service_request is gone');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'preferred_times'),
  '1b. bookings.preferred_times is gone');
-- No function still names it, so no later migration can bring it back unseen
-- (before phase 3: create_service_request, bookings_guard, booking_records_update).
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosrc ilike '%preferred_times%'), '',
  '1c. no function body mentions preferred_times');

-- 2. Every Service booking has its mode, start and end; an Experience booking has no mode.
select throws_ok(format($$ insert into bookings (kind, listing_id, provider_id, customer_id, customer_name, unit_price_cents, total_cents, status_changed_by)
  values ('service', %L, %L, %L, 'Sam', 4500, 4500, 'customer') $$, :'ls', :'p', :'cust'),
  '23514', null, '2a. a Service booking without a mode, start and end is refused');
select throws_ok(format($$ insert into bookings (kind, listing_id, provider_id, customer_id, service_mode, customer_name, unit_price_cents, total_cents, status_changed_by)
  values ('service', %L, %L, %L, 'approve', 'Sam', 4500, 4500, 'customer') $$, :'ls', :'p', :'cust'),
  '23514', null, '2b. ...or with a mode but no start and end');
select throws_ok(format($$ insert into bookings (kind, listing_id, provider_id, customer_id, session_id, service_mode, customer_name, unit_price_cents, total_cents, status_changed_by)
  values ('experience', %L, %L, %L, %L, 'instant', 'Sam', 3000, 3000, 'customer') $$, :'le', :'p', :'cust', :'s1'),
  '23514', null, '2c. an Experience booking can''t have a mode (bookings_service_mode_only_services)');

-- 3. The server's view works without the old column, and shows the mode.
select tests.authenticate_as_service_role();
select (create_service_booking(:'ls', :'cust', tests.slot(:'ls'), 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id as b1 \gset
select is((select service_mode from private.booking_records where id = :'b1'), 'approve', '3a. private.booking_records shows the booking''s mode');
select lives_ok(format($$ update private.booking_records set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours',
  stripe_payment_intent_id = 'pi_test_slots_only' where id = %L $$, :'b1'), '3b. ...and writes through it as before');
select is((select stripe_payment_intent_id from booking_finances where booking_id = :'b1'), 'pi_test_slots_only', '3c. (the money side written too)');

-- 4. Every booking trigger is on (the conversion switched them off and on).
select tests.clear_authentication();
select is((select count(*)::int from pg_trigger where tgrelid = 'public.bookings'::regclass and not tgisinternal and tgenabled = 'D'), 0,
  '4. no booking trigger is switched off');

-- 5. The next free slot, anywhere in the booking window (as a visitor).
select tests.authenticate_as_anon();
select is(service_next_slot(:'ls2'), null, '5a. a Service whose provider has no hours has no next slot');
select is(service_next_slot(:'ls'), (select min(starts_at) from service_slots(:'ls', :'today'::date, :'today'::date + 30)),
  '5b. ...and one with hours gets its first slot (the same as service_slots)');
select tests.clear_authentication();
insert into provider_date_hours (provider_id, on_date, starts, ends) values (:'p2', :'today'::date + 40, '10:00', '12:00');
select tests.authenticate_as_anon();
select is(service_next_slot(:'ls2'), ((:'today'::date + 40) + time '10:00') at time zone 'America/New_York',
  '5c. a first time 40 days out is found (past service_slots'' 31 days)');
select is(service_next_slot(:'ls2', :'today'::date + 41), null, '5d. ...and none from the day after it');
select tests.clear_authentication();
update provider_date_hours set on_date = :'today'::date + 70 where provider_id = :'p2';
select tests.authenticate_as_anon();
select is(service_next_slot(:'ls2'), null, '5e. hours past the booking window (60 days) don''t count');
select tests.clear_authentication();
update providers set stripe_payouts_enabled = false where id = :'p';
select is(service_next_slot(:'ls'), null, '5f. a Service customers can''t book (payouts not ready) has no next slot');

select * from finish();
rollback;
