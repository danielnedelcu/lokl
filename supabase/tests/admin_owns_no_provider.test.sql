-- The admin login never owns a provider: not by creating one, and not by
-- moving one to it. (Making an owner an admin is checked by the admin-grant
-- SQL in CLAUDE.md, not by a trigger on auth.users; see the migration.)
begin;
\ir _helpers/users.psql
select plan(6);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

-- The role lives in auth.users (where the JWT's app_metadata comes from), so
-- the admin is made one there, not only in the test JWT.
select tests.create_user('admin@test.local') as admin \gset
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = :'admin';
select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('newcomer@test.local') as newcomer \gset
select tests.create_user('staff@test.local') as staff \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Owner Tours', :'atl') returning id as po \gset

-- ---------------------------------------------------------------------------
-- A PROVIDER CAN'T BELONG TO AN ADMIN
-- ---------------------------------------------------------------------------

-- 1. The admin can't create a business for themselves, signed in...
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'Admin business', %L) $$, :'admin', :'atl'),
  '23514', 'An admin login can''t own a business. Use a separate login for the provider.',
  '1. the admin cannot create a business for their own login'
);

-- 2. ...and neither can the server or the SQL Editor create one for them.
select tests.authenticate_as_service_role();
select throws_ok(
  format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'Admin business', %L) $$, :'admin', :'atl'),
  '23514', 'An admin login can''t own a business. Use a separate login for the provider.',
  '2a. the server cannot create a business for the admin login'
);
select tests.clear_authentication();
select throws_ok(
  format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'Admin business', %L) $$, :'admin', :'atl'),
  '23514', 'An admin login can''t own a business. Use a separate login for the provider.',
  '2b. the database owner (SQL Editor) cannot either'
);

-- 3. Any other login can.
select tests.authenticate_as(:'newcomer');
select lives_ok(
  format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'New Tours', %L) $$, :'newcomer', :'atl'),
  '3. a login that isn''t an admin can create a business'
);

-- 4. A business can't be moved to the admin login...
select tests.clear_authentication();
select throws_ok(
  format($$ update providers set owner_id = %L where id = %L $$, :'admin', :'po'),
  '23514', 'An admin login can''t own a business. Use a separate login for the provider.',
  '4a. a business cannot be moved to the admin login'
);
-- ...but can be moved to another login.
select lives_ok(
  format($$ update providers set owner_id = %L where id = %L $$, :'staff', :'po'),
  '4b. a business can be moved to a login that isn''t an admin'
);
update providers set owner_id = :'owner' where id = :'po';

select * from finish();
rollback;
