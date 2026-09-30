-- Public provider names: signed-out visitors read the id and business name of
-- active providers with at least one visible listing, and nothing else.
-- Signed-in users get no new access.
begin;
\ir _helpers/users.psql
select plan(14);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('live@test.local') as u_live \gset
select tests.create_user('drafts@test.local') as u_drafts \gset
select tests.create_user('suspended@test.local') as u_susp \gset
select tests.create_user('hidden@test.local') as u_hidden \gset
select tests.create_user('customer@test.local') as u_customer \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into categories (kind, name, slug, active) values ('experience', 'Retired category', 'retired', true) returning id as retired \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

-- live: a visible listing. drafts: only a draft. suspended: a live listing,
-- but suspended. hidden: a live listing whose category is then deactivated.
insert into providers (owner_id, display_name, city_id) values (:'u_live', 'Live Tours', :'atl') returning id as p_live \gset
insert into providers (owner_id, display_name, city_id) values (:'u_drafts', 'Draft Tours', :'atl') returning id as p_drafts \gset
insert into providers (owner_id, display_name, city_id) values (:'u_susp', 'Suspended Tours', :'atl') returning id as p_susp \gset
insert into providers (owner_id, display_name, city_id) values (:'u_hidden', 'Hidden Tours', :'atl') returning id as p_hidden \gset

insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
select p, 'experience', c, :'atl', t, 'A listing made by the public names test.', 3000, 90, :'o4w', 'submitted'
from (values (:'p_live'::uuid, :'exp'::uuid, 'Live walk'), (:'p_drafts'::uuid, :'exp'::uuid, 'Draft walk'),
             (:'p_susp'::uuid, :'exp'::uuid, 'Suspended walk'), (:'p_hidden'::uuid, :'retired'::uuid, 'Hidden walk')) v(p, c, t);
insert into listing_photos (listing_id, storage_path, position, alt_text)
select l.id, l.provider_id || '/' || l.id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo of the listing' from listings l;
update listings set status = 'live', published_at = now() where provider_id in (:'p_live', :'p_susp', :'p_hidden');
update listings set status = 'draft' where provider_id = :'p_drafts';
update providers set status = 'suspended' where id = :'p_susp';
update categories set active = false where id = :'retired';

-- ---------------------------------------------------------------------------
-- SIGNED-OUT VISITORS
-- ---------------------------------------------------------------------------

select tests.authenticate_as_anon();

-- 1. A provider with a visible listing: id and name are readable.
select is((select display_name from providers where id = :'p_live'), 'Live Tours',
  '1a. a signed-out visitor reads the name of a provider with a visible listing');
select is((select count(*)::int from providers where id = :'p_live'), 1, '1b. ...and the provider''s id');

-- 2. Not a provider with only drafts, a suspended one, or one whose only
-- listing is hidden by an inactive category.
select is((select count(*)::int from providers where id = :'p_drafts'), 0,
  '2a. a signed-out visitor cannot see a provider with only drafts');
select is((select count(*)::int from providers where id = :'p_susp'), 0,
  '2b. a signed-out visitor cannot see a suspended provider, even with a live listing');
select is((select count(*)::int from providers where id = :'p_hidden'), 0,
  '2c. a signed-out visitor cannot see a provider whose listings are all hidden');

-- 3. No other column, even for a visible provider.
select throws_ok(format('select status from providers where id = %L', :'p_live'),
  '42501', 'permission denied for table providers', '3a. a signed-out visitor cannot read a provider''s status');
select throws_ok(format('select stripe_account_id from providers where id = %L', :'p_live'),
  '42501', 'permission denied for table providers', '3b. a signed-out visitor cannot read Stripe fields');
select throws_ok(format('select owner_id from providers where id = %L', :'p_live'),
  '42501', 'permission denied for table providers', '3c. a signed-out visitor cannot read the owner');
select throws_ok('select * from providers', '42501', 'permission denied for table providers',
  '3d. a signed-out visitor cannot read whole rows');

-- 4. Still no writes.
select throws_ok(format($$ update providers set display_name = 'Taken over' where id = %L $$, :'p_live'),
  '42501', 'permission denied for table providers', '4. a signed-out visitor cannot change a provider');

-- 5. The name disappears when the provider's last visible listing does.
select tests.clear_authentication();
update listings set status = 'unpublished', unpublished_reason = 'Taken down by the public names test.' where provider_id = :'p_live';
select tests.authenticate_as_anon();
select is((select count(*)::int from providers where id = :'p_live'), 0,
  '5. once its last visible listing is taken down, a provider is no longer public');
select tests.clear_authentication();
update listings set status = 'live', unpublished_reason = null where provider_id = :'p_live';

-- ---------------------------------------------------------------------------
-- SIGNED-IN USERS: NOTHING NEW
-- ---------------------------------------------------------------------------

-- 6. A signed-in customer still can't read providers (public pages read as
-- signed out), so no signed-in user can read another provider's Stripe fields.
select tests.authenticate_as(:'u_customer');
select is((select count(*)::int from providers), 0, '6. a signed-in user who owns no provider reads no providers');

-- 7. Another provider can't read the live provider's row either.
select tests.authenticate_as(:'u_drafts');
select is((select count(*)::int from providers where id = :'p_live'), 0,
  '7a. a provider cannot read another provider''s row');
select is((select count(*)::int from providers where id = :'p_drafts'), 1, '7b. ...but still reads their own');

select * from finish();
rollback;
