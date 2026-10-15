-- One booking per checkout attempt (migration checkout_keys): the page sends
-- a key per attempt; the booking functions return the booking already made
-- with that key (same details) instead of a second, refuse the same key with
-- other details, and a new Experience attempt ends the customer's earlier
-- unpaid attempts for the same session, so their spots can't block it.
begin;
\ir _helpers/users.psql
\ir _helpers/slots.psql
select plan(19);

select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('sam@test.local') as cust \gset
select tests.create_user('ann@test.local') as cust2 \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Peach Tours', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'A listing made for the checkout key tests.', 5000, 60, :'o4w', 'submitted') returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, location_mode, booking_mode)
values (:'p', 'service', :'svc', :'atl', 'Haircut', 'A listing made for the checkout key tests.', 4500, 60, :'o4w', 'submitted', 'provider_location', 'approve') returning id as ls \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'le', :'ls');
update listings set status = 'live', published_at = now() where id in (:'le', :'ls');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 2) returning id as s1 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '8 days', 2) returning id as s2 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '9 days', 4) returning id as s3 \gset
select gen_random_uuid() as k1 \gset
select gen_random_uuid() as k2 \gset
select gen_random_uuid() as k3 \gset
select repeat('a', 64) as h1 \gset
select repeat('b', 64) as h2 \gset

create function pg_temp.reserve(p_session uuid, p_customer uuid, p_party int, p_key uuid, p_hash text) returns public.bookings
language sql as $$
  select * from public.reserve_experience_booking(p_session, p_customer, p_party::smallint, 'Sam', 'sam@test.local', null, null,
    now() + interval '31 minutes', p_key, p_hash)
$$;
grant execute on function pg_temp.reserve(uuid, uuid, int, uuid, text) to service_role;

-- 1. The same key twice: the same booking, spots held once.
select tests.authenticate_as_service_role();
select (pg_temp.reserve(:'s1', :'cust', 2, :'k1', :'h1')).id as b1 \gset
select is((pg_temp.reserve(:'s1', :'cust', 2, :'k1', :'h1')).id, :'b1'::uuid, '1a. the same key and details return the booking already made');
select is((select count(*)::int from bookings where customer_id = :'cust' and session_id = :'s1'), 1, '1b. ...not a second one');
select is(session_spots_taken(:'s1'), 2, '1c. ...and the spots are held once');
select is((select checkout_key from bookings where id = :'b1'), :'k1'::uuid, '1d. the key is stored on the booking');
select is((select checkout_request_hash from bookings where id = :'b1'), :'h1', '1e. ...with the details'' fingerprint');

-- 2. The same key with other details is refused.
select throws_ok(format($$ select pg_temp.reserve(%L, %L, 1, %L, %L) $$, :'s1', :'cust', :'k1', :'h2'), '23514',
  'This checkout was started with different details. Check your details and try again.', '2. the same key with other details is refused');

-- 3. Another customer with the same key is a separate attempt.
select isnt((pg_temp.reserve(:'s2', :'cust2', 1, :'k1', :'h1')).id, :'b1'::uuid, '3. another customer''s key is their own');

-- 4. A new attempt (another key) for the same session ends the earlier
--    unpaid one, so its spots can't block this one; other sessions and
--    other customers are left alone.
select (pg_temp.reserve(:'s2', :'cust', 1, :'k3', :'h1')).id as on_s2 \gset
select lives_ok(format($$ select pg_temp.reserve(%L, %L, 1, %L, %L) $$, :'s1', :'cust', :'k2', :'h2'),
  '4a. a new attempt for the session goes through, though the earlier one held both spots');
select is((select status from bookings where id = :'b1'), 'expired', '4b. the earlier unpaid attempt is expired');
select is(session_spots_taken(:'s1'), 1, '4c. ...and only the new attempt holds spots');
select is((select status from bookings where id = :'on_s2'), 'pending_payment', '4d. the customer''s attempt on another session is untouched');
select is((select count(*)::int from bookings where customer_id = :'cust2' and status = 'pending_payment'), 1, '4e. ...and so is another customer''s');
-- A paid booking for the session is never ended by a new attempt.
select tests.clear_authentication();
update bookings set status = 'confirmed', status_changed_by = 'stripe' where customer_id = :'cust' and session_id = :'s1' and status = 'pending_payment';
select tests.authenticate_as_service_role();
select lives_ok(format($$ select pg_temp.reserve(%L, %L, 1, %L, null) $$, :'s1', :'cust', gen_random_uuid()), '4f. another attempt on the same session...');
select is((select count(*)::int from bookings where customer_id = :'cust' and session_id = :'s1' and status = 'confirmed'), 1, '4g. ...leaves the paid booking confirmed');

-- 5. A retry after the attempt ended returns it as it is (the server then
--    says the checkout has ended).
select is((pg_temp.reserve(:'s1', :'cust', 2, :'k1', :'h1')).status, 'expired', '5. the same key after the attempt ended returns it, expired');

-- 6. Services: the same key returns the same booking (even though its slot
-- is now held); other details are refused.
select tests.make_bookable(:'p');
select tests.slot(:'ls') as cs \gset
select (create_service_booking(:'ls', :'cust', :'cs', 'Sam', 'sam@test.local', null, null, null, now() + interval '31 minutes', :'k1', :'h1')).id as r1 \gset
select is((create_service_booking(:'ls', :'cust', :'cs', 'Sam', 'sam@test.local', null, null, null, now() + interval '31 minutes', :'k1', :'h1')).id,
  :'r1'::uuid, '6a. a Service retry with the same key returns the same booking');
select throws_ok(format($$ select create_service_booking(%L, %L, %L::timestamptz + interval '1 day', 'Sam', 'sam@test.local', null, null, null, now() + interval '31 minutes', %L, %L) $$, :'ls', :'cust', :'cs', :'k1', :'h2'),
  '23514', 'This checkout was started with different details. Check your details and try again.', '6b. ...and refuses other details');

-- 7. No key: as before, a new booking every time.
select isnt((pg_temp.reserve(:'s3', :'cust2', 1, null, null)).id, (pg_temp.reserve(:'s3', :'cust2', 1, null, null)).id, '7a. without a key, each call is its own booking');
select is((select count(*)::int from bookings where session_id = :'s3' and status = 'pending_payment'), 2, '7b. ...and neither ends the other (only keyed attempts do)');
select tests.clear_authentication();

select * from finish();
rollback;
