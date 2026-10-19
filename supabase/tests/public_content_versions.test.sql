-- Public content versions (migration public_content_versions): each source
-- table raises its scope's number on every write, the 60-second tables
-- (spots and open days) don't, anyone may read the numbers, and nobody but
-- the triggers writes them.
begin;
\ir _helpers/users.psql
select plan(17);

select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Version Tours', :'atl') returning id as prov \gset
insert into categories (kind, name, slug) values ('experience', 'Versions', 'versions') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Version Hill') returning id as area \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'prov', 'experience', :'cat', :'atl', 'A walk to version', 'A walk made by the content versions test.', 4000, 60, :'area')
returning id as listing \gset

create function pg_temp.v(p_scope text) returns bigint language sql as $$
  select version from public.public_content_versions where scope = p_scope $$;
create function pg_temp.snap() returns text language sql as $$
  select string_agg(scope || '=' || version, ' ' order by scope) from public.public_content_versions $$;

-- 1. The triggers: each source table, both kinds, its own scope; none on the
-- tables that stay on the 60-second limit.
select results_eq(
  $$ select (c.relname::text || ' ' || t.tgname::text || ' ' || encode(t.tgargs, 'escape')) collate "C" as trig
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where p.proname = 'public_content_changed' order by trig $$,
  $$ select (tbl || ' ' || tbl || suffix || ' ' || scope || '\000') collate "C" as trig
       from (values ('categories', 'markets'), ('cities', 'markets'), ('guide_photos', 'guides'), ('guides', 'guides'),
                    ('homepage_features', 'guides'), ('listing_photos', 'listings'), ('listing_ratings', 'listings'),
                    ('listing_service_areas', 'listings'), ('listings', 'listings'), ('provider_ratings', 'listings'),
                    ('providers', 'listings'), ('review_replies', 'listings'), ('reviews', 'listings'), ('service_areas', 'markets')) v(tbl, scope)
       cross join (values ('_public_content'), ('_public_content_truncate')) s(suffix)
      order by trig $$,
  '1a. each source table raises its own scope, after any write and after a truncate');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
            where p.proname = 'public_content_changed'
              and c.relname in ('bookings', 'experience_sessions', 'provider_schedules', 'service_open_days')), 0,
  '1b. spots and open days (bookings, sessions, weekly hours, open days) raise nothing: they keep the 60-second limit');

-- 2. Writes raise their scope, and only theirs.
select pg_temp.snap() as before \gset
select tests.authenticate_as(:'owner');
update listings set title = 'A walk to version two' where id = :'listing';
select tests.clear_authentication();
select is(pg_temp.v('listings'), (select split_part(split_part(:'before', 'listings=', 2), ' ', 1))::bigint + 1,
  '2a. a provider editing their own listing raises listings (the trigger runs as its owner)');
select is(pg_temp.v('markets') || ' ' || pg_temp.v('guides'),
  split_part(split_part(:'before', 'markets=', 2), ' ', 1) || ' ' || split_part(split_part(:'before', 'guides=', 2), ' ', 1),
  '2b. ...and nothing else');

select pg_temp.v('listings') as l0 \gset
update providers set status = 'suspended' where id = :'prov';
select is(pg_temp.v('listings'), :'l0'::bigint + 1, '2c. a provider suspended raises listings');

select pg_temp.v('markets') as m0, pg_temp.v('listings') as l1 \gset
update categories set active = false where id = :'cat';
select is(pg_temp.v('markets'), :'m0'::bigint + 1, '2d. a category switched off raises markets');
select is(pg_temp.v('listings'), :'l1'::bigint, '2e. ...and not listings');

select pg_temp.v('guides') as g0 \gset
insert into guides (market_id, slug, draft_title) values (:'atl', 'version-guide', 'Versions') returning id as guide \gset
select is(pg_temp.v('guides'), :'g0'::bigint + 1, '2f. a guide written raises guides');

select pg_temp.v('markets') as m1 \gset
update service_areas set name = 'Version Heights' where id = :'area';
select is(pg_temp.v('markets'), :'m1'::bigint + 1, '2g. an area renamed raises markets');

-- 3. Spots and open days: no raise.
update providers set status = 'active' where id = :'prov';
update categories set active = true where id = :'cat';
select pg_temp.snap() as quiet \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'listing', now() + interval '9 days', 10);
select is(pg_temp.snap(), :'quiet', '3a. a new session raises nothing (the 60-second limit)');

-- 4. Who reads and writes the numbers.
select tests.authenticate_as_anon();
select is((select count(*)::int from public.public_content_versions), 3, '4a. a visitor reads the three numbers');
select throws_ok($$ update public.public_content_versions set version = 0 $$, '42501', 'permission denied for table public_content_versions',
  '4b. ...and can''t change them');
select throws_ok($$ insert into public.public_content_versions (scope) values ('listings') $$, '42501', 'permission denied for table public_content_versions',
  '4c. ...or add one');
select tests.authenticate_as(:'cust');
select is((select count(*)::int from public.public_content_versions), 3, '4d. a signed-in user reads them');
select throws_ok($$ update public.public_content_versions set version = 0 $$, '42501', 'permission denied for table public_content_versions',
  '4e. ...and can''t change them');
select throws_ok($$ delete from public.public_content_versions $$, '42501', 'permission denied for table public_content_versions',
  '4f. ...or delete them');
select tests.clear_authentication();
select is((select count(*)::int from pg_proc p where p.proname = 'public_content_changed'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  '4g. the trigger function can''t be called through the API');

select * from finish();
rollback;
