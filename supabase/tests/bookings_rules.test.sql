-- Bookings: how they're created, priced and moved through their statuses.
-- Who can read them is in bookings_access.test.sql.
begin;
\ir _helpers/users.psql
select plan(51);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

-- A live Experience ($65 pp, 150 min) with a 3-spot session, a live
-- studio Service ($45, 60 min) and a live "I come to you" Service ($80).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 150, :'o4w', 'submitted')
returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id)
values (:'p', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 60, 'provider_location', :'o4w')
returning id as ls \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
values (:'p', 'service', :'svc', :'atl', 'Haircut at home', 'A classic cut wherever you are.', 8000, 'customer_location')
returning id as lh \gset
insert into listing_service_areas (listing_id, service_area_id) values (:'lh', :'o4w');
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'le', :'ls', :'lh');
update listings set status = 'live', published_at = now() where id in (:'le', :'ls', :'lh');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 3) returning id as s1 \gset

select (now() + interval '3 days')::timestamptz as t1 \gset
select (now() + interval '4 days')::timestamptz as t2 \gset

select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- COMMISSION RATES
-- ---------------------------------------------------------------------------

select is((select rate_bps from commission_rates where kind = 'service'), 1200, '1a. Services start at 12%');
select is((select rate_bps from commission_rates where kind = 'experience'), 2000, '1b. Experiences start at 20%');

-- ---------------------------------------------------------------------------
-- EXPERIENCES: reserving spots
-- ---------------------------------------------------------------------------

-- 2. A reservation is priced and split in the database.
select (reserve_experience_booking(:'s1', :'cust', 2::smallint, 'Sam Customer', 'sam@test.local', null, 'Vegetarian', now() + interval '30 minutes')).id as b1 \gset
select is((select status from bookings where id = :'b1'), 'pending_payment', '2a. a reservation starts as pending payment');
select is((select array[total_cents, commission_rate_bps, commission_cents, provider_amount_cents] from bookings where id = :'b1'),
  array[13000, 2000, 2600, 10400], '2b. 2 x $65 = $130: 20% commission $26, provider $104');
select is((select starts_at from bookings where id = :'b1'), (select starts_at from experience_sessions where id = :'s1'),
  '2c. the booking copies the session''s start');
select is((select session_spots_left(:'s1')), 1, '2d. two of three spots are now taken');

-- 3. The last spot can't go twice; asking for more than is left fails.
select throws_ok(
  format($$ select reserve_experience_booking(%L, %L, 2::smallint, 'Alex', 'alex@test.local', null, null, now() + interval '30 minutes') $$, :'s1', :'admin'),
  '23514', 'There aren''t enough spots left for 2 people.', '3a. a reservation larger than the spots left is refused');
select lives_ok(
  format($$ select reserve_experience_booking(%L, %L, 1::smallint, 'Alex', 'alex@test.local', null, null, now() + interval '30 minutes') $$, :'s1', :'admin'),
  '3b. the last spot can be reserved');
select throws_ok(
  format($$ select reserve_experience_booking(%L, %L, 1::smallint, 'Jo', 'jo@test.local', null, null, now() + interval '30 minutes') $$, :'s1', :'cust'),
  '23514', 'There aren''t enough spots left for 1 person.', '3c. a full session can''t be reserved');

-- 4. An expired checkout releases its spots.
update bookings set reserved_until = now() - interval '1 minute' where session_id = :'s1' and customer_id = :'admin';
select is((select session_spots_left(:'s1')), 1, '4. a lapsed reservation no longer holds its spot');

-- 5. Nobody books their own listing, and party size is 1 to 10.
select throws_ok(
  format($$ select reserve_experience_booking(%L, %L, 1::smallint, 'Me', 'me@test.local', null, null, now() + interval '30 minutes') $$, :'s1', :'owner'),
  '23514', 'You can''t book your own listing.', '5a. a provider can''t book their own listing');
select throws_ok(
  format($$ select reserve_experience_booking(%L, %L, 11::smallint, 'Big group', 'big@test.local', null, null, now() + interval '30 minutes') $$, :'s1', :'cust'),
  '23514', NULL, '5b. more than 10 people in one booking is refused');

-- ---------------------------------------------------------------------------
-- SERVICES: requests
-- ---------------------------------------------------------------------------

-- 6. A request: up to three different times, each 24 hours or more ahead.
select (create_service_request(:'ls', :'cust', array[:'t1'::timestamptz, :'t2'::timestamptz], 'Sam Customer', 'sam@test.local', '404-555-0100', 'Short on top', null, now() + interval '30 minutes')).id as b2 \gset
select is((select array[total_cents, commission_cents, provider_amount_cents] from bookings where id = :'b2'),
  array[4500, 540, 3960], '6a. $45: 12% commission $5.40, provider $39.60');
select throws_ok(
  format($$ select create_service_request(%L, %L, array[now() + interval '2 days', now() + interval '3 days', now() + interval '4 days', now() + interval '5 days'], 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes') $$, :'ls', :'cust'),
  '23514', 'Offer one to three different times.', '6b. more than three times is refused');
select throws_ok(
  format($$ select create_service_request(%L, %L, array[now() + interval '2 days', now() + interval '2 days'], 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes') $$, :'ls', :'cust'),
  '23514', 'Offer one to three different times.', '6c. the same time twice is refused');
select throws_ok(
  format($$ select create_service_request(%L, %L, array[now() + interval '20 hours'], 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes') $$, :'ls', :'cust'),
  '23514', 'Each time needs to be at least 24 hours from now.', '6d. less than 24 hours'' notice is refused');

-- 7. "I come to you" needs the customer's address; a studio Service doesn't take one.
select throws_ok(
  format($$ select create_service_request(%L, %L, array[now() + interval '2 days'], 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes') $$, :'lh', :'cust'),
  '23514', 'Add the address where the Service should happen.', '7a. an "I come to you" request needs an address');
select (create_service_request(:'lh', :'cust', array[:'t1'::timestamptz], 'Sam Customer', 'sam@test.local', null, null,
  '{"line1": "12 Elm Street", "city": "Atlanta", "state": "GA", "postal_code": "30312"}'::jsonb, now() + interval '30 minutes')).id as b3 \gset
select is((select line1 from booking_addresses where booking_id = :'b3'), '12 Elm Street', '7b. the address is stored with the request');
select throws_ok(
  format($$ select create_service_request(%L, %L, array[now() + interval '2 days'], 'Sam', 'sam@test.local', null, null, '{"line1": "1 A St", "city": "Atlanta", "state": "GA", "postal_code": "30312"}'::jsonb, now() + interval '30 minutes') $$, :'ls', :'cust'),
  '23514', 'This Service happens at the provider''s place, so no address is needed.', '7c. a studio Service doesn''t take an address');
select is((select array[customer_city, customer_postal_code] from bookings where id = :'b3'), array['Atlanta', '30312'],
  '7d. an "I come to you" request copies the customer''s city and zip code onto the booking');
select throws_ok(format($$ update bookings set customer_city = 'Decatur' where id = %L $$, :'b3'),
  '23514', 'A booking''s listing, customer, size, times offered and price can''t be changed.', '7e. the city and zip code on a booking can''t be changed');

-- ---------------------------------------------------------------------------
-- STATUSES
-- ---------------------------------------------------------------------------

-- 8. A Service checkout makes a request; an Experience can't be "requested".
select lives_ok(format($$ update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id = %L $$, :'b2'),
  '8a. a paid Service checkout becomes a request');
select throws_ok(format($$ update bookings set status = 'requested', status_changed_by = 'stripe' where id = %L $$, :'b1'),
  '23514', 'Only Service bookings are requested.', '8b. an Experience isn''t requested');

-- 9. Accepting: one of the offered times, which sets the end and the payout.
select throws_ok(format($$ update bookings set status = 'confirmed', starts_at = now() + interval '10 days', status_changed_by = 'provider' where id = %L $$, :'b2'),
  '23514', 'Accept one of the times the customer offered.', '9a. the provider must accept an offered time');
select lives_ok(format($$ update bookings set status = 'confirmed', starts_at = %L, status_changed_by = 'provider' where id = %L $$, :'t2', :'b2'),
  '9b. the provider accepts one of the offered times');
select is((select ends_at from bookings where id = :'b2'), :'t2'::timestamptz + interval '60 minutes', '9c. it ends after the listing''s duration');
select is((select payout_due_at from bookings where id = :'b2'), :'t2'::timestamptz + interval '60 minutes' + interval '24 hours',
  '9d. the payout is due 24 hours after it ends');

-- 9e. A request whose answer-by time has passed can't be accepted.
select (create_service_request(:'ls', :'cust', array[:'t1'::timestamptz], 'Sam Customer', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id as b5 \gset
update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() - interval '1 minute' where id = :'b5';
select throws_ok(format($$ update bookings set status = 'confirmed', starts_at = %L, status_changed_by = 'provider' where id = %L $$, :'t1', :'b5'),
  '23514', 'The time to answer this request has passed.', '9e. a request can''t be accepted after its answer-by time');

-- 9f. A time that has already passed can't be accepted. (Requests are made
-- 24 hours ahead, so this one is written directly, as only the server could.)
insert into bookings (kind, listing_id, provider_id, customer_id, preferred_times, customer_name, unit_price_cents, total_cents,
  commission_rate_bps, commission_cents, provider_amount_cents, status_changed_by)
values ('service', :'ls', :'p', :'cust', array[now() - interval '1 hour'], 'Sam Customer', 4500, 4500, 1200, 540, 3960, 'customer')
returning id as b6 \gset
update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id = :'b6';
select throws_ok(format($$ update bookings set status = 'confirmed', starts_at = preferred_times[1], status_changed_by = 'provider' where id = %L $$, :'b6'),
  '23514', 'That time has already passed.', '9f. a time that has passed can''t be accepted');
select is((select customer_city from bookings where id = :'b2'), null, '9g. a studio Service request has no customer city');

-- 10. Statuses only move along the allowed paths.
select throws_ok(format($$ update bookings set status = 'requested' where id = %L $$, :'b2'),
  '23514', 'A booking can''t go from confirmed to requested.', '10a. a confirmed booking can''t go back to requested');
select throws_ok(format($$ update bookings set status = 'paid_out' where id = %L $$, :'b2'),
  '23514', 'A booking can''t go from confirmed to paid_out.', '10b. a booking is completed before it''s paid out');
select throws_ok(format($$ update bookings set starts_at = %L where id = %L $$, :'t1', :'b2'),
  '23514', 'A booking''s time and payout date only change with its status.', '10c. a confirmed booking''s time can''t be changed');

-- 11. A booking's price and people never change.
select throws_ok(format($$ update bookings set total_cents = 100, unit_price_cents = 100 where id = %L $$, :'b2'),
  '23514', 'A booking''s listing, customer, size, times offered and price can''t be changed.', '11a. a booking''s price can''t be changed');

-- 12. Every change is in the booking's history, with who made it.
select is(
  (select array_agg(from_status || '>' || to_status || ':' || actor order by created_at, to_status) from booking_events where booking_id = :'b2'),
  array[null, 'pending_payment>requested:stripe', 'requested>confirmed:provider'],
  '12. each status change is recorded with who made it'
);

-- 13. A customer who cancels late (no refund) still lets the provider be paid;
-- a provider who cancels doesn't.
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'b1';
update bookings set status = 'cancelled', cancelled_by = 'customer', status_changed_by = 'customer' where id = :'b1';
select lives_ok(format($$ update bookings set status = 'paid_out', stripe_transfer_id = 'tr_test_13a', status_changed_by = 'system' where id = %L $$, :'b1'),
  '13a. a late customer cancellation with no refund can still be paid out');
update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id = :'b3';
update bookings set status = 'confirmed', starts_at = :'t1', status_changed_by = 'provider' where id = :'b3';
update bookings set status = 'cancelled', cancelled_by = 'provider', refunded_cents = total_cents, status_changed_by = 'provider' where id = :'b3';
select throws_ok(format($$ update bookings set status = 'paid_out', status_changed_by = 'system' where id = %L $$, :'b3'),
  '23514', 'A booking can''t go from cancelled to paid_out.', '13b. a provider''s cancellation is never paid out');
select throws_ok(format($$ update bookings set refunded_cents = 0 where id = %L $$, :'b3'),
  '23514', 'A refund can''t be undone.', '13c. a refund can''t be undone');

-- 14. A reported no-show holds the payout.
update bookings set status = 'completed', status_changed_by = 'system' where id = :'b2';
update bookings set problem_reported_at = now(), problem_note = 'Nobody was there.' where id = :'b2';
select throws_ok(format($$ update bookings set status = 'paid_out', status_changed_by = 'system' where id = %L $$, :'b2'),
  '23514', 'A reported problem holds the payout.', '14. a reported no-show holds the payout');

-- ---------------------------------------------------------------------------
-- PAYOUTS: only with a transfer, no hold and no open dispute
-- ---------------------------------------------------------------------------

-- A confirmed, completed Experience booking on its own session, ready to pay out.
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '8 days', 5) returning id as s3 \gset
select (reserve_experience_booking(:'s3', :'cust', 1::smallint, 'Sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b7 \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'b7';
update bookings set status = 'completed', status_changed_by = 'system' where id = :'b7';

-- 18. Nothing is paid out without its transfer recorded.
select throws_ok(format($$ update bookings set status = 'paid_out', status_changed_by = 'system' where id = %L $$, :'b7'),
  '23514', 'A booking is paid out only with its transfer recorded.', '18a. no transfer recorded, no payout');

-- 19. A hold stops the payout, and must say when it was set.
select throws_ok(format($$ update bookings set payout_hold = 'account_cannot_receive' where id = %L $$, :'b7'),
  '23514', NULL, '19a. a hold without a time is refused');
update bookings set payout_hold = 'account_cannot_receive', payout_held_at = now() where id = :'b7';
select throws_ok(format($$ update bookings set status = 'paid_out', stripe_transfer_id = 'tr_test_19', status_changed_by = 'system' where id = %L $$, :'b7'),
  '23514', 'This payout is on hold for lokl to review.', '19b. a held payout can''t be marked paid');
select throws_ok(format($$ update bookings set payout_hold = 'not_a_reason', payout_held_at = now() where id = %L $$, :'b7'),
  '23514', NULL, '19c. only the listed hold reasons are allowed');

-- 20. An open dispute stops the payout; a closed one doesn't.
update bookings set payout_hold = null, payout_held_at = null, disputed_at = now(), stripe_dispute_id = 'dp_test' where id = :'b7';
select throws_ok(format($$ update bookings set status = 'paid_out', stripe_transfer_id = 'tr_test_20', status_changed_by = 'system' where id = %L $$, :'b7'),
  '23514', 'An open dispute holds the payout.', '20a. an open dispute holds the payout');
update bookings set dispute_closed_at = now(), dispute_outcome = 'won' where id = :'b7';
select lives_ok(format($$ update bookings set status = 'paid_out', stripe_transfer_id = 'tr_test_20', status_changed_by = 'system' where id = %L $$, :'b7'),
  '20b. once the dispute closes in lokl''s favour, with a transfer, it can be paid out');

-- 21. Signed-in users can't set or clear a hold (the server does).
select tests.authenticate_as(:'owner');
select throws_ok(format($$ update bookings set payout_hold = null, payout_held_at = null where id = %L $$, :'b2'),
  '42501', NULL, '21. a provider can''t clear a payout hold');
select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- SESSIONS WITH BOOKINGS
-- ---------------------------------------------------------------------------

-- A fresh confirmed booking on a new session, so the session has spots taken.
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '9 days', 4) returning id as s2 \gset
select (reserve_experience_booking(:'s2', :'cust', 2::smallint, 'Sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b4 \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'b4';

-- 15. A booked session can't drop below what's booked.
select throws_ok(format($$ update experience_sessions set capacity = 1 where id = %L $$, :'s2'),
  '23514', 'This session already has 2 spots booked, so it can''t have fewer.', '15. capacity can''t drop below the spots booked');

-- 16. The provider can't move or cancel a booked session; the server can cancel it.
select tests.authenticate_as(:'owner');
select throws_ok(format($$ update experience_sessions set starts_at = now() + interval '10 days' where id = %L $$, :'s2'),
  '23514', 'This session has bookings, so its time can''t change.', '16a. a provider can''t move a booked session');
select throws_ok(format($$ update experience_sessions set status = 'cancelled' where id = %L $$, :'s2'),
  '23514', 'This session has bookings. Cancel it from your Sessions so everyone is refunded.', '16b. a provider can''t cancel a booked session directly');
select tests.authenticate_as_service_role();
select lives_ok(format($$ update experience_sessions set status = 'cancelled' where id = %L $$, :'s2'),
  '16c. the server can cancel a booked session (and refunds everyone)');

-- 17. A session with bookings can't be deleted.
select tests.clear_authentication();
select throws_ok(format($$ delete from experience_sessions where id = %L $$, :'s2'),
  '23503', NULL, '17. a session with bookings can''t be deleted');

select * from finish();
rollback;
