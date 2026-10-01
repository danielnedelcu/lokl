-- Bookings: who can read what. Customers read their own; providers read their
-- listings' bookings, and the customer's contact details and address only once
-- the booking is accepted or confirmed; the admin reads all; nobody writes from
-- the apps. Also the listing address for booked customers, commission rates,
-- and the provider's notifications.
begin;
\ir _helpers/users.psql
select plan(34);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('other-provider@test.local') as owner2 \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('other-customer@test.local') as cust2 \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Home Cuts', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Other Tours', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

-- A live studio Service with its address, and a live "I come to you" Service.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'p', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'o4w')
returning id as ls \gset
insert into listing_addresses (listing_id, line1, city, state, postal_code) values (:'ls', '5 Studio Lane', 'Atlanta', 'GA', '30312');
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
values (:'p', 'service', :'svc', :'atl', 'Haircut at home', 'A classic cut wherever you are.', 8000, 'customer_location')
returning id as lh \gset
insert into listing_service_areas (listing_id, service_area_id) values (:'lh', :'o4w');
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'ls', :'lh');
update listings set status = 'live', published_at = now() where id in (:'ls', :'lh');

select (now() + interval '3 days')::timestamptz as t1 \gset

-- The customer's studio request (ba) and home request (bh), both requested.
select tests.authenticate_as_service_role();
select (create_service_request(:'ls', :'cust', array[:'t1'::timestamptz], 'Sam Customer', 'sam@test.local', '404-555-0100', 'Short on top', null, now() + interval '30 minutes')).id as ba \gset
select (create_service_request(:'lh', :'cust', array[:'t1'::timestamptz], 'Sam Customer', 'sam@test.local', null, null,
  '{"line1": "12 Elm Street", "city": "Atlanta", "state": "GA", "postal_code": "30312"}'::jsonb, now() + interval '30 minutes')).id as bh \gset
update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id in (:'ba', :'bh');

-- ---------------------------------------------------------------------------
-- READING BOOKINGS
-- ---------------------------------------------------------------------------

-- 1. The customer reads their own; another customer reads none.
select tests.authenticate_as(:'cust');
select is((select count(*)::int from bookings), 2, '1a. a customer reads their own bookings');
select tests.authenticate_as(:'cust2');
select is((select count(*)::int from bookings), 0, '1b. a customer cannot read another customer''s bookings');

-- 2. The provider reads their listings' bookings, with the customer's name
-- and notes; another provider reads none.
select tests.authenticate_as(:'owner');
select is((select count(*)::int from bookings), 2, '2a. a provider reads bookings of their listings');
select is((select customer_name || ' / ' || customer_notes from bookings where id = :'ba'), 'Sam Customer / Short on top',
  '2b. the provider sees the customer''s name and notes on a request');
select tests.authenticate_as(:'owner2');
select is((select count(*)::int from bookings), 0, '2c. another provider cannot read them');

-- 3. The admin reads all; signed-out visitors nothing.
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from bookings), 2, '3a. the admin reads all bookings');
select tests.authenticate_as_anon();
select throws_ok('select count(*) from bookings', '42501', 'permission denied for table bookings', '3b. a signed-out visitor cannot read bookings');

-- 4. History follows the booking.
select tests.authenticate_as(:'cust');
select is((select count(*)::int from booking_events where booking_id = :'ba'), 2, '4a. the customer reads their booking''s history');
select tests.authenticate_as(:'owner2');
select is((select count(*)::int from booking_events), 0, '4b. another provider reads none');

-- ---------------------------------------------------------------------------
-- CONTACT DETAILS AND ADDRESSES: the provider only once accepted
-- ---------------------------------------------------------------------------

-- 5. Before acceptance: the customer sees their own details; the provider doesn't.
select tests.authenticate_as(:'cust');
select is((select email from booking_contacts where booking_id = :'ba'), 'sam@test.local', '5a. the customer reads their own contact details');
select is((select line1 from booking_addresses where booking_id = :'bh'), '12 Elm Street', '5b. the customer reads the address they gave');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from booking_contacts), 0, '5c. the provider cannot read the customer''s email or phone on a request');
select is((select count(*)::int from booking_addresses), 0, '5d. the provider cannot read the customer''s address on a request');

-- 6. After acceptance: the provider sees them, for that booking only.
select tests.authenticate_as_service_role();
update bookings set status = 'confirmed', starts_at = :'t1', status_changed_by = 'provider' where id in (:'ba', :'bh');
select tests.authenticate_as(:'owner');
select is((select email || ' / ' || phone from booking_contacts where booking_id = :'ba'), 'sam@test.local / 404-555-0100',
  '6a. once accepted, the provider reads the customer''s email and phone');
select is((select line1 from booking_addresses where booking_id = :'bh'), '12 Elm Street', '6b. once accepted, the provider reads the customer''s address');
select tests.authenticate_as(:'owner2');
select is((select count(*)::int from booking_contacts), 0, '6c. another provider still reads no contact details');
select is((select count(*)::int from booking_addresses), 0, '6d. another provider still reads no addresses');
select tests.authenticate_as(:'cust2');
select is((select count(*)::int from booking_contacts), 0, '6e. another customer reads no contact details');

-- ---------------------------------------------------------------------------
-- THE LISTING'S ADDRESS: customers with a confirmed booking
-- ---------------------------------------------------------------------------

-- 7. The booked customer reads the studio's address; nobody else does.
select tests.authenticate_as(:'cust');
select is((select line1 from listing_addresses where listing_id = :'ls'), '5 Studio Lane', '7a. a customer with a confirmed booking reads the listing''s address');
select tests.authenticate_as(:'cust2');
select is((select count(*)::int from listing_addresses), 0, '7b. a customer without a booking cannot');

-- 8. Not after it's cancelled.
select tests.authenticate_as_service_role();
update bookings set status = 'cancelled', cancelled_by = 'customer', refunded_cents = total_cents, status_changed_by = 'customer' where id = :'ba';
select tests.authenticate_as(:'cust');
select is((select count(*)::int from listing_addresses where listing_id = :'ls'), 0, '8. once cancelled, the customer can no longer read the address');

-- ---------------------------------------------------------------------------
-- NOBODY WRITES FROM THE APPS
-- ---------------------------------------------------------------------------

-- 9. Customers, providers and the admin can't create, change or delete bookings.
select tests.authenticate_as(:'cust');
select throws_ok(format($$ update bookings set status = 'confirmed' where id = %L $$, :'bh'),
  '42501', 'permission denied for table bookings', '9a. a customer cannot change a booking');
select throws_ok(format($$ insert into bookings (kind, listing_id, provider_id, customer_id, preferred_times, customer_name, unit_price_cents, total_cents, commission_rate_bps, commission_cents, provider_amount_cents) values ('service', %L, %L, %L, array[now() + interval '3 days'], 'X', 1, 1, 0, 0, 1) $$, :'ls', :'p', :'cust'),
  '42501', 'permission denied for table bookings', '9b. a customer cannot create a booking directly');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ update bookings set provider_amount_cents = 8000 where id = %L $$, :'bh'),
  '42501', 'permission denied for table bookings', '9c. a provider cannot change a booking');
select throws_ok(format($$ delete from bookings where id = %L $$, :'bh'),
  '42501', 'permission denied for table bookings', '9d. a provider cannot delete a booking');
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ update bookings set status = 'completed' where id = %L $$, :'bh'),
  '42501', 'permission denied for table bookings', '9e. the admin cannot change a booking directly either (routes do)');

-- 10. Nor call the booking functions.
select tests.authenticate_as(:'cust');
select throws_ok(format($$ select create_service_request(%L, %L, array[now() + interval '3 days'], 'Sam', 'sam@test.local', null, null, null, now()) $$, :'ls', :'cust'),
  '42501', 'permission denied for function create_service_request', '10. a customer cannot call the booking functions');

-- ---------------------------------------------------------------------------
-- COMMISSION RATES
-- ---------------------------------------------------------------------------

-- 11. Signed-in users read them; signed-out visitors don't.
select tests.authenticate_as(:'owner');
select is((select rate_bps from commission_rates where kind = 'service'), 1200, '11a. a provider reads the commission rates');
select tests.authenticate_as_anon();
select throws_ok('select count(*) from commission_rates', '42501', 'permission denied for table commission_rates', '11b. a signed-out visitor cannot');

-- 12. Only the admin changes them, and the change is stamped.
select tests.authenticate_as(:'owner');
with u as (update commission_rates set rate_bps = 0 where kind = 'service' returning 1)
select is((select count(*)::int from u), 0, '12a. a provider cannot change the commission');
select tests.authenticate_as_admin(:'admin');
select lives_ok($$ update commission_rates set rate_bps = 1100 where kind = 'service' $$, '12b. the admin can change the commission');
select tests.clear_authentication();
select is((select updated_by from commission_rates where kind = 'service'), :'admin'::uuid, '12c. ...and the change records who made it');

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS FOR THE PROVIDER
-- ---------------------------------------------------------------------------

-- 13. A request, and a cancellation by the customer, notify the provider;
-- the provider's own cancellation doesn't.
-- (Same transaction, so the same time: compared in name order.)
select is((select array_agg(kind order by kind) from notifications where provider_id = :'p' and booking_id = :'ba'),
  array['booking_cancelled', 'booking_requested'], '13a. the provider is told of the request and the customer''s cancellation');
select tests.authenticate_as_service_role();
update bookings set status = 'cancelled', cancelled_by = 'provider', refunded_cents = total_cents, status_changed_by = 'provider' where id = :'bh';
select tests.clear_authentication();
select is((select array_agg(kind) from notifications where booking_id = :'bh'), array['booking_requested'],
  '13b. the provider''s own cancellation doesn''t notify them');

select * from finish();
rollback;
