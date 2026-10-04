-- Released payout holds (migration payout_holds_released): the server
-- records them through private.booking_records, they only grow, they're
-- limited to the hold reasons, and only the service role can write them.
begin;
\ir _helpers/users.psql
select plan(8);

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'o4w', 'submitted')
returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text) values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'le';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 5) returning id as s1 \gset

select tests.authenticate_as_service_role();
select (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b \gset

-- 1. A new booking has released nothing; the server records a release through the view.
select is((select payout_holds_released from private.booking_records where id = :'b'), '{}'::text[], '1a. a new booking has no released holds');
update private.booking_records set payout_holds_released = array['refunded'] where id = :'b';
select is((select payout_holds_released from booking_finances where booking_id = :'b'), array['refunded'], '1b. a release written through private.booking_records lands in booking_finances');
update private.booking_records set payout_holds_released = array['refunded', 'provider_suspended'] where id = :'b';
select is((select payout_holds_released from booking_finances where booking_id = :'b'), array['refunded', 'provider_suspended'], '1c. a second release is added');

-- 2. A release can't be taken back, and only hold reasons are allowed.
select throws_ok(format($$ update booking_finances set payout_holds_released = array['provider_suspended'] where booking_id = %L $$, :'b'),
  '23514', 'A released payout hold can''t be taken back.', '2a. a released hold can''t be removed');
select throws_ok(format($$ update booking_finances set payout_holds_released = array['refunded', 'provider_suspended', 'anything'] where booking_id = %L $$, :'b'),
  '23514', null, '2b. only payout hold reasons can be released');

-- 3. Nobody else can write it: the provider and the customer can't touch booking_finances.
select tests.authenticate_as(:'owner');
select throws_ok(format($$ update booking_finances set payout_holds_released = array['refunded', 'provider_suspended', 'dispute'] where booking_id = %L $$, :'b'),
  '42501', null, '3a. the provider can''t add a release');
select tests.authenticate_as(:'cust');
select throws_ok(format($$ update booking_finances set payout_holds_released = array['refunded', 'provider_suspended', 'dispute'] where booking_id = %L $$, :'b'),
  '42501', null, '3b. nor can the customer');
-- The provider still reads their booking's finances (unchanged), including what was released.
select tests.authenticate_as(:'owner');
select is((select payout_holds_released from booking_finances where booking_id = :'b'), array['refunded', 'provider_suspended'], '3c. the provider can read what was released on their booking');

select * from finish();
rollback;
