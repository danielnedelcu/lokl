-- Who may call each function (migration function_execute_grants): no
-- function has PUBLIC EXECUTE; each helper reaches exactly the roles that
-- evaluate it; trigger functions reach no API role and their triggers still
-- fire; new functions reach only the server; and only the security-definer
-- functions listed here reach visitors or signed-in users.
--
-- A new security-definer function that visitors or signed-in users call
-- must be added to the list in 2 (with the roles), in the same migration's
-- change. Anything not on it fails here.
begin;
\ir _helpers/users.psql
select plan(26);

-- 1. No function in public has PUBLIC EXECUTE.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
   where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0, '1. no function in public can be called by PUBLIC');

-- 2. The security-definer functions that reach visitors or signed-in users:
--    exactly these, with exactly these roles.
select set_eq(
  $$ select p.proname || '|' || concat_ws(',',
       case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon' end,
       case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' end)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) $$,
  $$ values
       -- Admin pages (each checks is_admin() itself).
       ('admin_bookings_page|authenticated'), ('admin_dashboard|authenticated'), ('admin_listings_page|authenticated'),
       ('admin_providers_page|authenticated'), ('admin_reviews_page|authenticated'),
       -- Public pages.
       ('public_guide|anon,authenticated'), ('public_guides|anon,authenticated'), ('public_homepage_guides|anon,authenticated'),
       ('session_spots_left|anon,authenticated'), ('provider_is_public|anon,authenticated'),
       -- Signed-in features.
       ('my_saved|authenticated'), ('review_state|authenticated'), ('booking_can_be_reviewed|authenticated'),
       ('review_window_open|authenticated'), ('review_reportable|authenticated'),
       -- Helpers called inside access rules.
       ('current_provider_id|authenticated'), ('current_active_provider_id|authenticated'),
       ('listing_parents_active|anon,authenticated') $$,
  '2. only the listed security-definer functions reach visitors or signed-in users');

-- 3. Each helper reaches exactly the roles that evaluate it.
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'), '3a. is_admin(): signed-in users (43 access rules)');
select ok(not has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') and not has_function_privilege('service_role', 'public.is_admin()', 'EXECUTE'),
  '3b. ...not visitors or the server');
select ok(has_function_privilege('authenticated', 'public.current_provider_id()', 'EXECUTE'), '3c. current_provider_id(): signed-in users');
select ok(not has_function_privilege('anon', 'public.current_provider_id()', 'EXECUTE') and not has_function_privilege('service_role', 'public.current_provider_id()', 'EXECUTE'),
  '3d. ...not visitors or the server');
select ok(has_function_privilege('anon', 'public.listing_parents_active(uuid,uuid,uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.listing_parents_active(uuid,uuid,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.listing_parents_active(uuid,uuid,uuid)', 'EXECUTE'),
  '3e. listing_parents_active(): visitors, signed-in users and the server (the booking functions)');
select ok(has_function_privilege('authenticated', 'public.has_contact_details(text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.has_contact_details(text)', 'EXECUTE'),
  '3f. has_contact_details(): signed-in users and the server (its check constraints run as the writer)');
select ok(not has_function_privilege('anon', 'public.has_contact_details(text)', 'EXECUTE'), '3g. ...not visitors');
select ok(not has_function_privilege('anon', 'public.provider_slug(text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.provider_slug(text)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.provider_slug(text)', 'EXECUTE'),
  '3h. provider_slug(): no API role (only its security-definer trigger calls it)');
select ok(not has_function_privilege('anon', 'public.review_display_name(text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.review_display_name(text)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.review_display_name(text)', 'EXECUTE'),
  '3i. review_display_name(): no API role (only security-definer functions call it)');

-- 4. Trigger functions reach no API role.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege(r.role, p.oid, 'EXECUTE')),
  0, '4. no API role can execute a trigger function');

-- 5. What still works, and what doesn't, in practice.
select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('other@test.local') as other \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

-- A signed-in user creates their business: the slug trigger still fires.
select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'Peach Tours', %L) $$, :'owner', :'atl'),
  '5a. a signed-in user creates their business');
select tests.clear_authentication();
select is((select slug from providers where owner_id = :'owner'), 'peach-tours', '5b. ...and providers_set_slug still fills its address');
select id as p1 from providers where owner_id = :'owner' \gset
select tests.authenticate_as(:'other');
select throws_ok($$ select public.provider_slug('Peach Tours') $$, '42501', 'permission denied for function provider_slug',
  '5c. calling provider_slug() directly is refused (no probing which names are taken)');

-- The check constraint calling has_contact_details() still runs for the writer.
select tests.authenticate_as(:'owner');
select throws_ok(format($$ update providers set headline = 'Call 404 555 0123 any time' where id = %L $$, :'p1'), '23514', null,
  '5d. a phone number in a headline is still refused by its check constraint');
select lives_ok(format($$ update providers set headline = 'Food walks through Atlanta' where id = %L $$, :'p1'),
  '5e. ...and a normal headline is fine (the trigger set_updated_at fires too)');
select tests.clear_authentication();

-- A live listing: visitors still see it (the rule calls listing_parents_active()).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p1', 'experience', :'cat', :'atl', 'Taco crawl', 'A listing made for the function privileges tests.', 5000, 60, :'o4w', 'submitted')
returning id as l1 \gset
insert into listing_photos (listing_id, storage_path, position, alt_text) values (:'l1', :'p1' || '/' || :'l1' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'l1';
set local role anon;
select is((select count(*)::int from listings where id = :'l1'), 1, '5f. visitors still read a live listing');
select throws_ok($$ select public.is_admin() $$, '42501', 'permission denied for function is_admin', '5g. ...but can''t call is_admin()');
select throws_ok($$ select public.current_provider_id() $$, '42501', 'permission denied for function current_provider_id',
  '5h. ...or current_provider_id()');
reset role;

-- Signed-in users: their own rows through rules that call current_provider_id() and is_admin().
select tests.authenticate_as(:'owner');
select is((select count(*)::int from listings where provider_id = :'p1'), 1, '5i. a provider reads their own listings');
select tests.clear_authentication();

-- The server still runs the booking functions' visibility check.
select tests.authenticate_as_service_role();
select is(public.listing_parents_active(:'p1', :'cat', :'atl'), true, '5j. the server can call listing_parents_active()');
select throws_ok($$ select public.is_admin() $$, '42501', 'permission denied for function is_admin', '5k. ...but not is_admin()');
select tests.clear_authentication();

-- 6. A new function reaches only the server.
create function public.zz_new_fn() returns int language sql as 'select 1';
select ok(has_function_privilege('service_role', 'public.zz_new_fn()', 'EXECUTE'), '6a. a new function: the server can call it');
select ok(not has_function_privilege('anon', 'public.zz_new_fn()', 'EXECUTE') and not has_function_privilege('authenticated', 'public.zz_new_fn()', 'EXECUTE'),
  '6b. ...visitors and signed-in users can''t, until a migration grants it');
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
           where p.oid = 'public.zz_new_fn()'::regprocedure and a.grantee = 0), 0, '6c. ...and it has no PUBLIC EXECUTE');

select * from finish();
rollback;
