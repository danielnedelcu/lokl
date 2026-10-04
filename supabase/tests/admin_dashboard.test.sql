-- The admin dashboard (migration admin_dashboard): only admins can read it;
-- its numbers on known bookings (refunds, a full refund, a Service paid on
-- acceptance, unpaid bookings, and payments either side of Atlanta midnight
-- at the edge of the 30 days); and the new page filters return what the
-- numbers count, so a number and the page behind it agree.
begin;
\ir _helpers/users.psql
select plan(26);

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('owner.one@test.local') as owner1 \gset
select tests.create_user('owner.two@test.local') as owner2 \gset
select tests.create_user('owner.three@test.local') as owner3 \gset
select tests.create_user('customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
-- p1 can be paid; p2 hasn't set up payouts; p3 can be paid but was last paid 100 days ago.
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'owner1', 'Peach Tours', :'atl', 'acct_test_one', true, true) returning id as p1 \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Not Ready Yet', :'atl') returning id as p2 \gset
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'owner3', 'Quiet Walks', :'atl', 'acct_test_three', true, true) returning id as p3 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'hair') returning id as hair \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

create function pg_temp.live_listing(p_provider uuid, p_kind text, p_title text, p_price integer) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, location_mode)
  values (p_provider, p_kind, (select id from public.categories where slug = case when p_kind = 'service' then 'hair' else 'food' end),
          (select id from public.cities where slug = 'atlanta'), p_title, 'A listing made for the dashboard tests, long enough.',
          p_price, 60, (select id from public.service_areas where name = 'Old Fourth Ward'), 'submitted',
          case when p_kind = 'service' then 'provider_location' end)
  returning id into v;
  insert into public.listing_photos (listing_id, storage_path, position, alt_text)
  values (v, p_provider || '/' || v || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
  update public.listings set status = 'live', published_at = now() where id = v;
  return v;
end;
$$;
select pg_temp.live_listing(:'p1', 'experience', 'Taco crawl', 6500) as le1 \gset
select pg_temp.live_listing(:'p1', 'service', 'Silk press', 9000) as ls1 \gset
select pg_temp.live_listing(:'p3', 'experience', 'Garden walk', 3000) as le3 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le1', now() + interval '7 days', 50) returning id as s1 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le3', now() + interval '7 days', 50) returning id as s3 \gset
-- A listing waiting for review (stays submitted).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p1', 'experience', :'cat', :'atl', 'Mural ride', 'A listing waiting for review in the dashboard tests.', 4000, 60, :'o4w', 'submitted');

select tests.authenticate_as_service_role();
create temp table bk (label text primary key, id uuid);
insert into bk select 'today', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Paid Today', 'a@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'partial', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Part Refunded', 'b@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'full', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Fully Refunded', 'c@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'edge_in', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Edge In', 'd@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'edge_out', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Edge Out', 'e@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'unpaid', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Never Paid', 'f@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'old', (reserve_experience_booking(:'s3', :'cust', 1::smallint, 'Long Ago', 'g@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'svc_paid', (create_service_request(:'ls1', :'cust', array[now() + interval '3 days'], 'Svc Paid', 'h@test.local', null, null, null, now() + interval '30 minutes')).id;
insert into bk select 'svc_held', (create_service_request(:'ls1', :'cust', array[now() + interval '3 days'], 'Svc Held', 'i@test.local', null, null, null, now() + interval '30 minutes')).id;
select tests.clear_authentication();

-- The bookings' states and payment times, written directly with the guard off.
-- "Today" and the 30 days are by the Atlanta calendar.
select (now() at time zone 'America/New_York')::date as today \gset
alter table bookings disable trigger bookings_guard;
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'confirmed', status_changed_by = 'stripe', confirmed_at = now() where id = (select id from bk where label = 'today');
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'confirmed', status_changed_by = 'stripe', confirmed_at = now() - interval '10 days', refunded_cents = 2000 where id = (select id from bk where label = 'partial');
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'cancelled', status_changed_by = 'customer', cancelled_by = 'customer', cancelled_at = now(), confirmed_at = now() - interval '5 days', refunded_cents = 6500 where id = (select id from bk where label = 'full');
-- 00:30 on the first day of the 30 (counted), and 23:30 the day before it (not), in Atlanta.
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'confirmed', status_changed_by = 'stripe', confirmed_at = ((:'today'::date - 29) + time '00:30') at time zone 'America/New_York' where id = (select id from bk where label = 'edge_in');
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'confirmed', status_changed_by = 'stripe', confirmed_at = ((:'today'::date - 30) + time '23:30') at time zone 'America/New_York' where id = (select id from bk where label = 'edge_out');
update bookings set status = 'expired', status_changed_by = 'stripe' where id = (select id from bk where label = 'unpaid');
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'completed', status_changed_by = 'system', confirmed_at = now() - interval '100 days' where id = (select id from bk where label = 'old');
-- A Service is paid when the provider accepts (the card is charged); a held one isn't paid yet.
update bookings set payout_due_at = coalesce(starts_at, now() + interval '3 days') + interval '1 day', status = 'confirmed', status_changed_by = 'provider', starts_at = now() + interval '3 days', confirmed_at = now() - interval '1 day' where id = (select id from bk where label = 'svc_paid');
update bookings set status = 'requested', status_changed_by = 'stripe' where id = (select id from bk where label = 'svc_held');
alter table bookings enable trigger bookings_guard;
-- An open dispute on today's booking, and a guide draft.
update booking_finances set disputed_at = now() where booking_id = (select id from bk where label = 'today');
insert into guides (market_id, slug) values (:'atl', 'dashboard-test-draft');

-- 1. Admins only.
select tests.authenticate_as(:'cust');
select throws_ok($$ select admin_dashboard() $$, '42501', 'Admins only.', '1a. a customer can''t read the dashboard');
select tests.authenticate_as(:'owner1');
select throws_ok($$ select admin_dashboard() $$, '42501', 'Admins only.', '1b. nor can a provider');
select tests.clear_authentication();
set local role anon;
select throws_ok($$ select admin_dashboard() $$, '42501', null, '1c. nor a signed-out visitor');
reset role;

-- The bookings that must not be listed (read before signing in as the admin).
select string_agg(id::text, ',') as excluded from bk where label in ('edge_out', 'unpaid', 'svc_held', 'old') \gset

-- 2. The numbers.
select tests.authenticate_as_admin(:'admin');
create temp table d as select admin_dashboard() as v;
select is((select v ->> 'today' from d)::date, :'today'::date, '2a. today is Atlanta''s date');
select is((select v ->> 'paid_from' from d)::date, :'today'::date - 29, '2b. the 30 days start 29 days before today');
select is((select v ->> 'active_since' from d)::date, :'today'::date - 89, '2c. the 90 days start 89 days before today');
-- Paid in the 30 days: today (6500), partial (6500 - 2000), full (6500 - 6500), edge_in (6500), svc_paid (9000).
select is((select (v ->> 'bookings')::int from d), 5, '2d. five bookings paid in the 30 days (not the one paid at 23:30 the day before, the unpaid one, the held Service or the old one)');
select is((select (v ->> 'gmv_cents')::int from d), 6500 + 4500 + 0 + 6500 + 9000, '2e. GMV: charged less refunded');
-- 20% of 6500 on three Experiences kept (the partial refund keeps its commission), none on the full refund, 12% of 9000.
select is((select (v ->> 'commission_cents')::int from d), 1300 * 3 + 1080, '2f. commission: none on the full refund, all of it on the partial one');
select is((select (v ->> 'active_providers')::int from d), 1, '2g. one provider paid in the 90 days (not the one last paid 100 days ago)');
select is((select (v -> 'listings_to_review' ->> 'experience')::int from d), 1, '2h. one Experience waits for review');
select is((select (v -> 'listings_to_review' ->> 'service')::int from d), 0, '2i. no Service does');
select is((select (v ->> 'open_disputes')::int from d), 1, '2j. one open dispute');
select is((select (v ->> 'guide_drafts')::int from d), 1, '2k. one guide draft');
select is((select (v ->> 'providers_not_payable')::int from d), 1, '2l. one active provider can''t be paid yet');
select ok((select (v ->> 'bookings_attention')::int from d) >= 1, '2m. the open dispute counts as needing attention');

-- 3. The pages behind the numbers say the same.
create temp table pg as select admin_bookings_page(p_paid_from => :'today'::date - 29, p_paid_to => :'today'::date, p_page_size => 100) as v;
select is((select (v ->> 'total')::int from pg), (select (v ->> 'bookings')::int from d), '3a. Bookings "paid between" lists the same bookings the card counts');
select is((select (v -> 'totals' ->> 'charged_cents')::int - (v -> 'totals' ->> 'refunded_cents')::int from pg), (select (v ->> 'gmv_cents')::int from d),
  '3b. ...and its totals give the same GMV');
select is((select (v -> 'totals' ->> 'commission_cents')::int from pg), (select (v ->> 'commission_cents')::int from d), '3c. ...and the same commission');
select ok((select not exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'id' = any (string_to_array(:'excluded', ','))) from pg),
  '3d. none of the bookings outside the range, or unpaid, are listed');
select is((admin_bookings_page(p_paid_from => :'today'::date - 29) ->> 'total')::int, 5, '3e. "paid from" alone works');
select is((admin_providers_page(p_paid_since => :'today'::date - 89) -> 'rows' -> 0 ->> 'display_name'), 'Peach Tours', '3f. Providers "paid since" lists the active provider');
select is((admin_providers_page(p_paid_since => :'today'::date - 89) ->> 'total')::int, (select (v ->> 'active_providers')::int from d), '3g. ...as many as the card counts');
select is((admin_providers_page(p_paid_since => :'today'::date - 120) ->> 'total')::int, 2, '3h. a longer range finds the one paid 100 days ago too');
select is((admin_providers_page(p_payout_setup => 'not_ready') -> 'rows' -> 0 ->> 'display_name'), 'Not Ready Yet', '3i. Providers "can''t be paid yet" lists the provider without payouts');
select throws_ok($$ select admin_providers_page(p_payout_setup => 'anything') $$, '22023', null, '3j. an unknown payout setup is refused');

select * from finish();
rollback;
