-- Explicit API grants (migration explicit_api_grants): what the API roles
-- may do no longer depends on the CLI's default privileges
-- (auto_expose_new_tables is off in supabase/config.toml).
begin;
\ir _helpers/users.psql
select plan(20);

-- 1. The server reads and writes every table in public.
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not (has_table_privilege('service_role', c.oid, 'SELECT') and has_table_privilege('service_role', c.oid, 'INSERT')
              and has_table_privilege('service_role', c.oid, 'UPDATE') and has_table_privilege('service_role', c.oid, 'DELETE'))),
  0, '1a. service_role can read and write every table in public');
select tests.authenticate_as_service_role();
select lives_ok($$ select count(*) from public.bookings $$, '1b. ...for example bookings');
select lives_ok($$ select count(*) from public.reviews $$, '1c. ...and reviews');
select tests.clear_authentication();

-- 2. Nobody through the API can truncate, reference, trigger or maintain.
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
   cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
   where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege(r.role, c.oid, p.priv)),
  0, '2a. no API role holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any table');
select tests.authenticate_as_service_role();
select throws_ok($$ truncate public.job_runs $$, '42501', 'permission denied for table job_runs', '2b. the server can''t truncate a table');
select tests.clear_authentication();

-- 3. Visitors: the public tables, read only.
set local role anon;
select lives_ok($$ select count(*) from public.listings $$, '3a. visitors read listings (row rules show the live ones)');
select lives_ok($$ select count(*) from public.categories $$, '3b. ...and categories');
select throws_ok($$ select count(*) from public.bookings $$, '42501', 'permission denied for table bookings', '3c. ...but not bookings');
select throws_ok($$ insert into public.cities (name, slug, state, timezone) values ('X', 'x', 'GA', 'America/New_York') $$,
  '42501', 'permission denied for table cities', '3d. ...and can''t write');
reset role;

-- 4. Signed-in users keep their table grants; row rules decide the rows.
select tests.create_user('signed.in@test.local') as u \gset
select tests.authenticate_as(:'u');
select lives_ok($$ select count(*) from public.bookings $$, '4a. signed-in users read bookings (only their own rows)');
select lives_ok($$ select count(*) from public.notifications $$, '4b. ...and notifications');
select throws_ok($$ insert into public.job_runs (job) values ('x') $$, '42501', 'permission denied for table job_runs',
  '4c. ...but can''t write the server''s tables (job_runs)');
select throws_ok($$ update public.bookings set status = 'cancelled' where false $$, '42501', 'permission denied for table bookings',
  '4d. ...and can''t update bookings directly');
select tests.clear_authentication();

-- 5. Functions the server calls.
select ok(has_function_privilege('service_role', 'public.admin_dashboard()', 'EXECUTE'), '5a. the server can call admin_dashboard()');
select ok(has_function_privilege('service_role', 'public.session_spots_left(uuid)', 'EXECUTE'), '5b. ...and session_spots_left()');
select ok(not has_function_privilege('anon', 'public.admin_dashboard()', 'EXECUTE'), '5c. visitors can''t call admin_dashboard()');

-- 6. Objects created from now on: the server only, until a migration grants more.
create table public.grants_probe (id int);
create function public.grants_probe_fn() returns int language sql as 'select 1';
select ok(has_table_privilege('service_role', 'public.grants_probe', 'SELECT,INSERT,UPDATE,DELETE'), '6a. a new table: the server can use it');
select ok(not has_table_privilege('anon', 'public.grants_probe', 'SELECT') and not has_table_privilege('authenticated', 'public.grants_probe', 'SELECT'),
  '6b. ...visitors and signed-in users can''t, until granted');
select ok(not has_table_privilege('authenticated', 'public.grants_probe', 'TRUNCATE'), '6c. ...nor truncate it');
select ok(has_function_privilege('service_role', 'public.grants_probe_fn()', 'EXECUTE'), '6d. a new function: the server can call it');

select * from finish();
rollback;
