-- Saved listings and providers (migration saved_items): a customer saves,
-- reads and unsaves only their own; only what's visible can be saved;
-- nobody else (the provider, other customers, admins, visitors) can read
-- them; the 500 limit; and my_saved() with its naming rule.
begin;
\ir _helpers/users.psql
select plan(32);

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('peach@test.local') as owner1 \gset
select tests.create_user('quiet@test.local') as owner2 \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('other@test.local') as cust2 \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner1', 'Peach Tours', :'atl') returning id as p1 \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Quiet Walks', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

create function pg_temp.listing(p_provider uuid, p_title text, p_live boolean) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
  values (p_provider, 'experience', (select id from public.categories where slug = 'food'), (select id from public.cities where slug = 'atlanta'),
          p_title, 'A listing made for the saved items tests, long enough.', 5000, 60,
          (select id from public.service_areas where name = 'Old Fourth Ward'), 'submitted') returning id into v;
  insert into public.listing_photos (listing_id, storage_path, position, alt_text) values (v, p_provider || '/' || v || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
  if p_live then update public.listings set status = 'live', published_at = now() where id = v; end if;
  return v;
end;
$$;
select pg_temp.listing(:'p1', 'Taco crawl', true) as live1 \gset
select pg_temp.listing(:'p1', 'Mural ride', true) as live2 \gset
select pg_temp.listing(:'p1', 'Garden walk', true) as live3 \gset
select pg_temp.listing(:'p1', 'Still a draft', false) as draft1 \gset

-- 1. A customer saves, reads and unsaves their own.
select tests.authenticate_as(:'cust');
select lives_ok(format($$ insert into saved_listings (listing_id) values (%L) $$, :'live1'), '1a. a customer saves a live listing');
select is((select customer_id from saved_listings where listing_id = :'live1'), :'cust'::uuid, '1b. ...as themselves (the database fills it in)');
select lives_ok(format($$ insert into saved_providers (provider_id) values (%L) $$, :'p1'), '1c. a customer saves a provider with a public profile');
select lives_ok(format($$ insert into saved_listings (listing_id) values (%L) on conflict do nothing $$, :'live1'), '1d. saving again changes nothing');
select is((select count(*)::int from saved_listings), 1, '1e. ...still one row');
select throws_ok(format($$ insert into saved_listings (customer_id, listing_id) values (%L, %L) $$, :'cust2', :'live2'), '42501', null,
  '1f. a customer can''t save for someone else');

-- 2. Only what's visible can be saved.
select throws_ok(format($$ insert into saved_listings (listing_id) values (%L) $$, :'draft1'), '42501', null, '2a. a draft listing can''t be saved');
select throws_ok(format($$ insert into saved_providers (provider_id) values (%L) $$, :'p2'), '42501', null, '2b. a provider with no live listing can''t be saved');

-- 3. Nobody else can read them.
select tests.authenticate_as(:'cust2');
select is((select count(*)::int from saved_listings) + (select count(*)::int from saved_providers), 0, '3a. another customer sees none of them');
select tests.authenticate_as(:'owner1');
select is((select count(*)::int from saved_listings) + (select count(*)::int from saved_providers), 0,
  '3b. the provider can''t see who saved their listing or profile');
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from saved_listings) + (select count(*)::int from saved_providers), 0, '3c. nor can an admin');
select tests.clear_authentication();
set local role anon;
select throws_ok($$ select count(*) from saved_listings $$, '42501', null, '3d. visitors can''t read them');
select throws_ok($$ select my_saved() $$, '42501', null, '3e. visitors can''t call my_saved()');
reset role;
select tests.authenticate_as(:'cust2');
delete from saved_listings where listing_id = :'live1';
select tests.clear_authentication();
select is((select count(*)::int from saved_listings), 1, '3f. another customer can''t unsave them');

-- 4. my_saved(): available, and the names.
select tests.authenticate_as(:'cust');
insert into saved_listings (listing_id) values (:'live2'), (:'live3');
select is(jsonb_array_length(my_saved() -> 'listings'), 3, '4a. the customer''s saved listings');
select is((my_saved() -> 'listings' -> 0 ->> 'available')::boolean, true, '4b. a live one is available');
select is((select count(*)::int from jsonb_array_elements(my_saved() -> 'listings') x where x ->> 'title' is null), 0, '4c. all have their names while live');
select tests.clear_authentication();
-- The provider unlists one themselves (back to a draft); lokl takes another down.
update listings set status = 'draft' where id = :'live2';
update listings set status = 'unpublished', unpublished_reason = 'Taken down by lokl for the tests.' where id = :'live3';
select tests.authenticate_as(:'cust');
create temp table ms as select x from jsonb_array_elements(my_saved() -> 'listings') x;
select is((select (x ->> 'available')::boolean from ms where x ->> 'listing_id' = :'live2'), false, '4d. an unlisted one is no longer available');
select is((select x ->> 'title' from ms where x ->> 'listing_id' = :'live2'), 'Mural ride', '4e. ...and keeps its name (the provider unlisted it)');
select is((select x ->> 'title' from ms where x ->> 'listing_id' = :'live3'), null, '4f. one lokl took down has no name');
select is((select (x ->> 'available')::boolean from ms where x ->> 'listing_id' = :'live1'), true, '4g. the live one is still available');
-- The provider is suspended: their listings and profile lose their names.
select tests.clear_authentication();
update providers set status = 'suspended' where id = :'p1';
select tests.authenticate_as(:'cust');
select is((select x ->> 'title' from jsonb_array_elements(my_saved() -> 'listings') x where x ->> 'listing_id' = :'live1'), null,
  '4h. a suspended provider''s listing has no name');
select is((my_saved() -> 'providers' -> 0 ->> 'name'), null, '4i. ...nor does the provider');
select is((my_saved() -> 'providers' -> 0 ->> 'available')::boolean, false, '4j. ...who is no longer available');
select tests.clear_authentication();
update providers set status = 'active' where id = :'p1';
update listings set status = 'live', unpublished_reason = null where id = :'live3';
-- Only the provider's own listings closed: the provider keeps their name.
update listings set status = 'draft' where provider_id = :'p1';
select tests.authenticate_as(:'cust');
select is((my_saved() -> 'providers' -> 0 ->> 'name'), 'Peach Tours', '4k. a provider with no live listing keeps their name');
select is((my_saved() -> 'providers' -> 0 ->> 'available')::boolean, false, '4l. ...but is no longer available');

-- 5. Unsaving always works, even when it's no longer available.
delete from saved_listings where listing_id = :'live2';
select is((select count(*)::int from saved_listings where listing_id = :'live2'), 0, '5a. an unavailable listing can be unsaved');
delete from saved_providers where provider_id = :'p1';
select is((select count(*)::int from saved_providers), 0, '5b. an unavailable provider can be unsaved');
select is(jsonb_array_length(my_saved() -> 'providers'), 0, '5c. my_saved() follows');

-- 6. Another customer's my_saved() is their own.
select tests.authenticate_as(:'cust2');
select is(my_saved(), '{"listings": [], "providers": []}'::jsonb, '6a. another customer gets only their own (none)');

-- 7. At most 500 of each.
select tests.clear_authentication();
update listings set status = 'live' where id = :'live1';
insert into saved_listings (customer_id, listing_id)
  select :'cust2', l.id from (select pg_temp.listing(:'p1', 'Bulk ' || n, true) as id from generate_series(1, 500) n) l;
select tests.authenticate_as(:'cust2');
select throws_ok(format($$ insert into saved_listings (listing_id) values (%L) $$, :'live1'), '23514',
  'You''ve saved 500 listings, the most there''s room for. Remove some to save more.', '7a. the 501st saved listing is refused');
select tests.clear_authentication();
select is((select count(*)::int from saved_listings where customer_id = :'cust2'), 500, '7b. ...and 500 stay');

select * from finish();
rollback;
