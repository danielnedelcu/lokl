-- The policy guard (migration policy_helpers_once_per_query): access rules
-- run their helpers once per query, not once per row.
--
-- 1. auth.uid(), auth.jwt(), is_admin(), current_provider_id() and
--    current_active_provider_id() are always wrapped as (select ...), so
--    Postgres runs them once per query.
-- 2. No read rule (and no update or delete rule's USING, which is checked
--    against every row the statement could touch) calls a helper that takes
--    arguments: those run per row and can't be wrapped. Use a set computed
--    once instead, as `column in (select public.active_provider_ids())`.
--    Insert checks and update WITH CHECK see only the rows being written,
--    so helpers there are fine. Exceptions are listed below with a reason.
-- 3. Every table with row security has at least one rule.
begin;
\ir _helpers/users.psql
select plan(10);

create temp view rules as
select schemaname || '.' || tablename || '.' || policyname as name, cmd,
       coalesce(qual, '') as using_text, coalesce(with_check, '') as check_text
from pg_policies
where schemaname in ('public', 'private', 'storage');

-- 1. Unwrapped once-per-query helpers.
select is(
  (select string_agg(name, ', ' order by name) from rules
   where using_text || ' ' || check_text ~ '(?<!SELECT )\m(auth\.uid|auth\.jwt|is_admin|current_provider_id|current_active_provider_id)\(\)'),
  null,
  '1. every auth.uid(), auth.jwt(), is_admin(), current_provider_id() and current_active_provider_id() is wrapped as (select ...)');

-- 2. Helpers with arguments in rules checked against many rows.
create temp table per_row_allowed (name text primary key, why text not null);
insert into per_row_allowed values
  ('public.reviews.reviews_update_customer', 'review_window_open(booking_id): a customer editing their own review, by id'),
  ('public.reviews.reviews_delete_customer', 'review_window_open(booking_id): a customer deleting their own review, by id');

select is(
  (select string_agg(distinct r.name || ' calls ' || p.proname || '()', ', ')
   from rules r
   join pg_proc p on p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace) and p.pronargs > 0
   where r.cmd in ('SELECT', 'ALL', 'UPDATE', 'DELETE')
     and r.using_text ~ ('\m' || p.proname || '\(')
     and r.name not in (select name from per_row_allowed)),
  null,
  '2a. no read, update or delete rule calls a helper per row (use a set computed once per query)');
select is(
  (select count(*)::int from per_row_allowed a join rules r on r.name = a.name and r.using_text ~ '\mreview_window_open\('),
  (select count(*)::int from per_row_allowed),
  '2b. ...and each listed exception still exists and still needs it');

-- 3. Row security without any rule.
select is(
  (select string_agg(n.nspname || '.' || c.relname, ', ' order by 1)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relrowsecurity and c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  null,
  '3. every table with row security has at least one rule');

-- 4. The visitors' rules use the once-per-query sets (the same conditions
--    as listing_parents_active() and provider_is_public()).
select is(
  (select count(*)::int from rules
   where name in ('public.listings.listings_read_public', 'public.listing_service_areas.listing_service_areas_read_public',
                  'public.listing_photos.listing_photos_read_public', 'public.experience_sessions.experience_sessions_read_public',
                  'public.providers.providers_read_public', 'public.saved_listings.saved_listings_insert_own')
     and using_text || check_text ~ 'active_provider_ids\(\)'
     and using_text || check_text ~ 'active_category_ids\(\)'
     and using_text || check_text ~ 'active_city_ids\(\)'),
  6,
  '4. the six visibility rules check provider, category and city against the once-per-query sets');


-- 5. The rewritten rules show visitors exactly what the per-row helpers
--    said: every combination of provider (active, suspended), category and
--    city (active or not) and listing status.
select id as atl from cities where slug = 'atlanta' \gset
insert into cities (slug, name, state, timezone, active) values ('closedtown', 'Closedtown', 'GA', 'America/New_York', false) returning id as closed \gset
insert into categories (kind, name, slug) values ('experience', 'Open', 'guard-open') returning id as catopen \gset
insert into categories (kind, name, slug, active) values ('experience', 'Shut', 'guard-shut', false) returning id as catshut \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Guard area') returning id as a1 \gset
insert into service_areas (city_id, kind, name) values (:'closed', 'neighborhood', 'Guard area 2') returning id as a2 \gset
select tests.create_user('guard1@test.local') as u1 \gset
select tests.create_user('guard2@test.local') as u2 \gset
select tests.create_user('guard3@test.local') as u3 \gset
insert into providers (owner_id, display_name, city_id) values (:'u1', 'Guard Active', :'atl') returning id as pa \gset
insert into providers (owner_id, display_name, city_id, status) values (:'u2', 'Guard Suspended', :'atl', 'suspended') returning id as ps \gset
insert into providers (owner_id, display_name, city_id) values (:'u3', 'Guard No Listings', :'atl') returning id as pn \gset
set local session_replication_role = replica;
insert into listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, unpublished_reason)
select 'guard-' || row_number() over (), p, 'experience', c, ci, 'Guard listing', 'A listing for the policy guard test.', 5000, 60,
       case when ci = :'atl'::uuid then :'a1'::uuid else :'a2'::uuid end, st, case when st = 'unpublished' then 'Taken down for the test.' end
from unnest(array[:'pa', :'ps']::uuid[]) p, unnest(array[:'catopen', :'catshut']::uuid[]) c,
     unnest(array[:'atl', :'closed']::uuid[]) ci, unnest(array['live', 'draft', 'unpublished']) st;
insert into experience_sessions (listing_id, starts_at, capacity) select id, now() + interval '3 days', 10 from listings where slug like 'guard-%';
insert into listing_photos (listing_id, storage_path, position, alt_text) select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where slug like 'guard-%';
set local session_replication_role = origin;

create temp table expected as
select l.id, l.provider_id, (l.status = 'live' and public.listing_parents_active(l.provider_id, l.category_id, l.city_id)) as visible
from listings l where l.slug like 'guard-%';
grant select on expected to anon;
grant execute on function public.provider_is_public(uuid) to anon; -- test only: the expected side of 5e
select is((select count(*)::int from expected where visible), 1, '5a. (the data: 24 listings, exactly one visible by the old helper)');

select tests.authenticate_as_anon();
select set_eq($$ select id from listings where slug like 'guard-%' $$, $$ select id from expected where visible $$,
  '5b. visitors see exactly the listings listing_parents_active() allowed');
select set_eq($$ select listing_id from experience_sessions where listing_id in (select id from expected) $$,
  $$ select id from expected where visible $$, '5c. ...and exactly their sessions, and the same for photos below');
select set_eq($$ select listing_id from listing_photos where listing_id in (select id from expected) $$,
  $$ select id from expected where visible $$, '5d. ...photos');
select set_eq($$ select id from providers where id in (select provider_id from expected) or display_name like 'Guard %' $$,
  $$ select id from providers where display_name like 'Guard %' and public.provider_is_public(id) $$,
  '5e. ...and exactly the providers provider_is_public() allowed (not the suspended one, nor one with no visible listing)');
select tests.clear_authentication();

select * from finish();
rollback;
