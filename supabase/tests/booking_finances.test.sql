-- Booking finances and no-show reports (migration booking_finances): who
-- can read them, that the money never changes, that a report is final, and
-- that private.booking_records is the server's alone.
begin;
\ir _helpers/users.psql
select plan(22);

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('other-provider@test.local') as owner2 \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('other-customer@test.local') as cust2 \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Other Tours', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'o4w', 'submitted')
returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text) values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'le';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 5) returning id as s1 \gset

select tests.authenticate_as_service_role();
select (reserve_experience_booking(:'s1', :'cust', 2::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b \gset
update private.booking_records set status = 'confirmed', status_changed_by = 'stripe', stripe_payment_intent_id = 'pi_test', stripe_charge_id = 'ch_test' where id = :'b';
-- A report, written directly with the guard off (it needs a booking that has started).
select tests.clear_authentication();
insert into booking_reports (booking_id, note) values (:'b', 'Nobody was there at all.');
select tests.authenticate_as_service_role();

-- 1. The server writes and reads through private.booking_records.
select is((select array[commission_cents, provider_amount_cents] from private.booking_records where id = :'b'), array[2600, 10400],
  '1a. a booking''s money is in booking_finances, read with the booking through private.booking_records');
select is((select stripe_charge_id from booking_finances where booking_id = :'b'), 'ch_test', '1b. ...and an update through it lands in booking_finances');
select is((select status from bookings where id = :'b'), 'confirmed', '1c. ...and in bookings, in the same statement');

-- 2. The money a booking was made with never changes, and must add up.
select throws_ok(format($$ update booking_finances set provider_amount_cents = 1 where booking_id = %L $$, :'b'),
  '23514', 'A booking''s commission split can''t be changed.', '2a. the commission split can''t be changed');
select tests.clear_authentication();
insert into bookings (kind, listing_id, provider_id, customer_id, session_id, starts_at, party_size, customer_name, unit_price_cents, total_cents, status_changed_by)
values ('experience', :'le', :'p', :'cust2', :'s1', now() + interval '7 days', 1, 'Jo', 6500, 6500, 'customer') returning id as b2 \gset
select throws_ok(format($$ insert into booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents) values (%L, 2000, 1300, 1) $$, :'b2'),
  '23514', 'The commission and the provider''s share must add up to the booking''s total.', '2b. a split that doesn''t add up to the total is refused');
insert into booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents) values (:'b2', 2000, 1300, 5200);

-- 3. A report is final.
select throws_ok(format($$ update booking_reports set note = 'Changed my mind about it.' where booking_id = %L $$, :'b'),
  '23514', 'A problem has already been reported on this booking.', '3. a no-show report can''t be changed');

-- 4. Who reads the money: the booking's provider and admins, never the customer.
select tests.authenticate_as(:'owner');
select is((select provider_amount_cents from booking_finances where booking_id = :'b'), 10400, '4a. the provider reads their share');
select tests.authenticate_as(:'owner2');
select is((select count(*)::int from booking_finances), 0, '4b. another provider reads nothing');
select tests.authenticate_as(:'cust');
select is((select count(*)::int from booking_finances), 0, '4c. the customer can''t read the commission, payouts or Stripe ids');
select is((select total_cents || '/' || refunded_cents from bookings where id = :'b'), '13000/0', '4d. ...but still reads what they paid and were refunded');
select throws_ok($$ select commission_cents from bookings $$, '42703', NULL, '4e. the commission isn''t on bookings any more');
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from booking_finances), 2, '4f. the admin reads every booking''s money');
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from booking_finances $$, '42501', NULL, '4g. a signed-out visitor can''t read it at all');

-- 5. Who reads the no-show note: the customer who wrote it and admins, never the provider.
select tests.authenticate_as(:'cust');
select is((select note from booking_reports where booking_id = :'b'), 'Nobody was there at all.', '5a. the customer reads their own report');
select tests.authenticate_as(:'cust2');
select is((select count(*)::int from booking_reports), 0, '5b. another customer reads none');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from booking_reports), 0, '5c. the provider can''t read the customer''s note');
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from booking_reports), 1, '5d. the admin reads it');

-- 6. private.booking_records is the server's alone.
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from private.booking_records $$, '42501', NULL, '6a. a signed-out visitor can''t read private.booking_records');
select tests.authenticate_as(:'cust');
select throws_ok($$ select count(*) from private.booking_records $$, '42501', NULL, '6b. nor can a customer');
select tests.authenticate_as(:'owner');
select throws_ok($$ select count(*) from private.booking_records $$, '42501', NULL, '6c. nor can a provider');
select throws_ok(format($$ update private.booking_records set payout_hold = null where id = %L $$, :'b'), '42501', NULL, '6d. ...or write through it');
select tests.authenticate_as_admin(:'admin');
select throws_ok($$ select count(*) from private.booking_records $$, '42501', NULL, '6e. not even an admin''s sign-in: only the server''s key');

select * from finish();
rollback;
