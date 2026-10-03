-- Server-side search, filters and pages for the admin tables
-- (20261003072758_admin_search_pages): only admins may call them; every
-- filter, the search across each field, multi-word search, literal % and _,
-- sorting, paging and totals; owners' emails only through the admin
-- function; the payout-setup rule matches the app's.
begin;
\ir _helpers/users.psql
select plan(49);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('owner.one@test.local') as owner1 \gset
select tests.create_user('second.owner@test.local') as owner2 \gset
select tests.create_user('customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into cities (slug, name, state, timezone) values ('savannah', 'Savannah', 'GA', 'America/New_York') returning id as sav \gset
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'owner1', 'Peach Tours', :'atl', 'acct_test_ready', true, true) returning id as p1 \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Harbor Walks', :'sav') returning id as p2 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into categories (kind, name, slug) values ('service', 'Hair', 'hair') returning id as hair \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into service_areas (city_id, kind, name) values (:'sav', 'neighborhood', 'Historic District') returning id as hist \gset

-- Two live Experiences (one each), and a Service draft.
create function pg_temp.live_experience(p_provider uuid, p_city uuid, p_area uuid, p_title text, p_price integer) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
  values (p_provider, 'experience', (select id from public.categories where slug = 'food'), p_city, p_title,
          'A walk made for the search tests, long enough.', p_price, 60, p_area, 'submitted') returning id into v;
  insert into public.listing_photos (listing_id, storage_path, position, alt_text)
  values (v, p_provider || '/' || v || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
  update public.listings set status = 'live', published_at = now() where id = v;
  return v;
end;
$$;
select pg_temp.live_experience(:'p1', :'atl', :'o4w', 'Taco crawl', 6500) as le1 \gset
select pg_temp.live_experience(:'p2', :'sav', :'hist', 'Ghost walk', 3000) as le2 \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
values (:'p1', 'service', :'hair', :'atl', 'Silk press', 'A silk press made for the search tests.', 9000, 'customer_location') returning id as ls1 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le1', now() + interval '7 days', 50) returning id as s1 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le2', now() + interval '20 days', 50) returning id as s2 \gset

-- Bookings: four on the Taco crawl, two on the Ghost walk; names with % and _.
select tests.authenticate_as_service_role();
create temp table bk (label text primary key, id uuid);
insert into bk select 'sam', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Sam Rivera', 'sam.rivera@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'pct', (reserve_experience_booking(:'s1', :'cust', 1::smallint, '100% Fun Club', 'club@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'hundred', (reserve_experience_booking(:'s1', :'cust', 1::smallint, '100x Fun Club', 'other@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'under', (reserve_experience_booking(:'s1', :'cust', 2::smallint, 'Jo_Ann Smith', 'jo@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'ghost', (reserve_experience_booking(:'s2', :'cust', 1::smallint, 'Ghost Fan', 'fan@test.local', null, null, now() + interval '30 minutes')).id;
-- "Jo-Ann": an unescaped _ in "jo_ann" would match it too.
insert into bk select 'dash', (reserve_experience_booking(:'s2', :'cust', 1::smallint, 'Jo-Ann Lee', 'jl@test.local', null, null, now() + interval '30 minutes')).id;
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id in (select id from bk);
select id as b_sam from bk where label = 'sam' \gset
select id as b_pct from bk where label = 'pct' \gset
select id as b_under from bk where label = 'under' \gset
select id as b_ghost from bk where label = 'ghost' \gset
-- Needs attention: one held payout, one failed reversal.
update private.booking_records set payout_hold = 'dispute', payout_held_at = now() where id = :'b_sam';
update private.booking_records set reversal_failed_at = now(), reversal_failure = 'test' where id = :'b_ghost';
select tests.clear_authentication();

create function pg_temp.ids(p jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((r ->> 'id')::uuid order by n), '{}') from jsonb_array_elements(p -> 'rows') with ordinality as t(r, n)
$$;

-- ---------------------------------------------------------------------------
-- 1. WHO MAY CALL THEM
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'cust');
select throws_ok($$ select admin_bookings_page() $$, '42501', 'Admins only.', '1a. a customer can''t list bookings');
select throws_ok($$ select admin_listings_page('experience') $$, '42501', 'Admins only.', '1b. ...or listings');
select throws_ok($$ select admin_providers_page() $$, '42501', 'Admins only.', '1c. ...or providers (and their owners'' emails)');
select tests.authenticate_as(:'owner1');
select throws_ok($$ select admin_bookings_page() $$, '42501', 'Admins only.', '1d. a provider can''t list bookings, even their own, this way');
select throws_ok($$ select admin_providers_page(p_q := 'test.local') $$, '42501', 'Admins only.', '1e. ...or search owners'' emails');
select tests.authenticate_as_anon();
select throws_ok($$ select admin_bookings_page() $$, '42501', NULL, '1f. signed-out visitors can''t call them');
select throws_ok($$ select admin_providers_page() $$, '42501', NULL, '1g. ...the providers one included');

-- ---------------------------------------------------------------------------
-- 2. BOOKINGS
-- ---------------------------------------------------------------------------

select tests.authenticate_as_admin(:'admin');
select is((admin_bookings_page() ->> 'total')::int, 6, '2a. the admin sees every booking');
select is((admin_bookings_page() ->> 'total_exact')::boolean, true, '2b. ...with an exact total');
select is(pg_temp.ids(admin_bookings_page(p_q := 'rivera')), array[:'b_sam'::uuid], '2c. search finds a customer''s name');
select is(pg_temp.ids(admin_bookings_page(p_q := 'SAM.RIVERA@')), array[:'b_sam'::uuid], '2d. ...their email, ignoring case');
select is((admin_bookings_page(p_q := 'ghost walk') ->> 'total')::int, 2, '2e. ...the listing''s title');
select is((admin_bookings_page(p_q := 'peach') ->> 'total')::int, 4, '2f. ...the provider''s name');
select is((admin_bookings_page(p_q := 'peach rivera') ->> 'total')::int, 1, '2g. every word has to match (in any field)');
select is((admin_bookings_page(p_q := 'peach nobody') ->> 'total')::int, 0, '2h. ...so a word that matches nothing finds nothing');
select is(pg_temp.ids(admin_bookings_page(p_q := '100%')), array[:'b_pct'::uuid], '2i. % is matched literally, not as a wildcard');
select is(pg_temp.ids(admin_bookings_page(p_q := 'jo_ann')), array[:'b_under'::uuid], '2j. ...and so is _');
select is((admin_bookings_page(p_q := '$130.00') ->> 'total')::int, 1, '2k. an amount finds the booking charged it (2 x $65)');
select is((admin_bookings_page(p_status := 'confirmed', p_kind := 'experience') ->> 'total')::int, 6, '2l. status and kind filters');
select is((admin_bookings_page(p_kind := 'service') ->> 'total')::int, 0, '2m. ...a kind with none is empty');
select is((admin_bookings_page(p_provider_id := :'p2') ->> 'total')::int, 2, '2n. the provider filter');
select is((admin_bookings_page(p_from := current_date + 6, p_to := current_date + 8) ->> 'total')::int, 4, '2o. a date range (in the market''s days)');
select is((admin_bookings_page(p_from := current_date + 10) ->> 'total')::int, 2, '2p. ...open-ended from a day');
select is(pg_temp.ids(admin_bookings_page(p_attention := 'holds')), array[:'b_sam'::uuid], '2q. a "needs attention" group as a filter');
select is(admin_bookings_page(p_with_attention := true, p_q := 'nobody') -> 'attention',
  '{"holds": 1, "owed": 1, "reports": 0, "disputes": 0, "unavailable": 0}'::jsonb,
  '2r. the attention counts cover every booking, whatever the page shows');
select throws_ok($$ select admin_bookings_page(p_sort := 'b.id; drop table bookings') $$, '22023', NULL, '2s. only known sorts are accepted');
select throws_ok($$ select admin_bookings_page(p_attention := 'everything') $$, '22023', NULL, '2t. ...and known attention groups');
select is(admin_bookings_page(p_sort := 'listing', p_desc := false, p_page_size := 1) -> 'rows' -> 0 -> 'listing' ->> 'title', 'Ghost walk',
  '2u. sorting by listing, A to Z: Ghost walk first');
select ok(
  (select array_length(pg_temp.ids(admin_bookings_page(p_page := 1, p_page_size := 2)) || pg_temp.ids(admin_bookings_page(p_page := 2, p_page_size := 2))
     || pg_temp.ids(admin_bookings_page(p_page := 3, p_page_size := 2)), 1)) = 6
  and (select count(distinct x) from unnest(pg_temp.ids(admin_bookings_page(p_page := 1, p_page_size := 2)) || pg_temp.ids(admin_bookings_page(p_page := 2, p_page_size := 2))
     || pg_temp.ids(admin_bookings_page(p_page := 3, p_page_size := 2))) as x) = 6,
  '2v. pages of 2 cover all 6 bookings exactly once');
select is((admin_bookings_page(p_page := 9) -> 'rows'), '[]'::jsonb, '2w. a page past the end is empty, not an error');
select is((admin_bookings_page(p_page := 9) ->> 'total')::int, 6, '2x. ...and still says the total');
select is((admin_bookings_page(p_q := 'rivera') -> 'rows' -> 0 ->> 'commission_cents') is not null, true,
  '2y. rows carry the money split, as the table shows it');

-- 2z. Money totals across every match (20261003161858_admin_booking_totals).
select tests.clear_authentication();
-- A booking refunded in full keeps no commission (test-only, with the guard off).
alter table public.bookings disable trigger bookings_guard;
update public.bookings set refunded_cents = total_cents, refunded_at = now() where id = :'b_ghost';
alter table public.bookings enable trigger bookings_guard;
create temp table expect as
select count(*) filter (where b.confirmed_at is not null) as n,
  coalesce(sum(b.total_cents) filter (where b.confirmed_at is not null), 0) as charged,
  coalesce(sum(b.refunded_cents) filter (where b.confirmed_at is not null), 0) as refunded,
  coalesce(sum(case when b.refunded_cents >= b.total_cents then 0 else f.commission_cents end) filter (where b.confirmed_at is not null), 0) as commission
from public.bookings b join public.booking_finances f on f.booking_id = b.id where b.id in (select id from bk);
grant select on expect to authenticated;
select tests.authenticate_as_admin(:'admin');
select is(admin_bookings_page() -> 'totals',
  (select jsonb_build_object('charged_count', n, 'charged_cents', charged, 'refunded_cents', refunded, 'commission_cents', commission) from expect),
  '2z1. the totals are the sums across every booking, a fully refunded one keeping no commission');
select is((admin_bookings_page(p_page_size := 1) -> 'totals' ->> 'charged_cents')::bigint, (select charged from expect),
  '2z2. ...whatever the page size: every match, not just the page');
select is((admin_bookings_page(p_provider_id := :'p2') -> 'totals' ->> 'charged_cents')::int, 6000,
  '2z3. the totals follow the filters (two $30 Ghost walks)');
select is(admin_bookings_page(p_q := 'nobody') -> 'totals',
  '{"charged_count": 0, "charged_cents": 0, "refunded_cents": 0, "commission_cents": 0}'::jsonb,
  '2z4. no matches: zeros, not nulls');

-- ---------------------------------------------------------------------------
-- 3. LISTINGS
-- ---------------------------------------------------------------------------

select is((admin_listings_page('experience') ->> 'total')::int, 2, '3a. Experiences only');
select is(pg_temp.ids(admin_listings_page('service')), array[:'ls1'::uuid], '3b. Services only, drafts included');
select is(pg_temp.ids(admin_listings_page('experience', p_q := 'ghost')), array[:'le2'::uuid], '3c. search finds a title');
select is(pg_temp.ids(admin_listings_page('experience', p_q := 'harbor')), array[:'le2'::uuid], '3d. ...and a provider''s name');
select is((admin_listings_page('experience', p_city_id := :'atl') ->> 'total')::int, 1, '3e. the market filter');
select is((admin_listings_page('service', p_status := 'live') ->> 'total')::int, 0, '3f. the status filter');
select throws_ok($$ select admin_listings_page('everything') $$, '22023', NULL, '3g. only Experiences or Services');

-- ---------------------------------------------------------------------------
-- 4. PROVIDERS
-- ---------------------------------------------------------------------------

select is(pg_temp.ids(admin_providers_page(p_q := 'second.owner')), array[:'p2'::uuid], '4a. the admin finds a provider by owner email');
select is(admin_providers_page(p_q := 'harbor') -> 'rows' -> 0 ->> 'owner_email', 'second.owner@test.local', '4b. ...and sees it in the row');
select is(pg_temp.ids(admin_providers_page(p_payout_setup := 'ready')), array[:'p1'::uuid], '4c. the payout-setup filter');
select is((select array_agg(k order by k) from jsonb_object_keys(admin_providers_page(p_q := 'peach') -> 'rows' -> 0) k),
  array['city', 'created_at', 'display_name', 'id', 'owner_email', 'payout_setup', 'status'],
  '4c2. rows carry only what the page shows: no Stripe account id or owner id');
select is(pg_temp.ids(admin_providers_page(p_city_id := :'sav')), array[:'p2'::uuid], '4d. the market filter');
select is(
  array[provider_payout_setup(null, true, true), provider_payout_setup('acct_x', true, false), provider_payout_setup('acct_x', true, true)],
  array['not_started', 'in_progress', 'ready'],
  '4e. payout setup in SQL matches payoutSetupOf(): no account, partway, ready');

select * from finish();
rollback;
