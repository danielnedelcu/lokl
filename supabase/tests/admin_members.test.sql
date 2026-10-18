-- Admin roles, read live, with the second factor required (migration
-- admin_members; docs/design/admin-roles.md, cutover step 4).
begin;
\ir _helpers/users.psql
select plan(45);

select tests.create_user('am-owner@test.local') as owner \gset
select tests.create_user('am-owner2@test.local') as owner2 \gset
select tests.create_user('am-support@test.local') as sup \gset
select tests.create_user('am-gone@test.local') as gone \gset
select tests.create_user('am-invited@test.local') as invited \gset
select tests.create_user('am-customer@test.local') as cust \gset
select tests.create_user('am-provider@test.local') as prov \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'prov', 'AM Cuts', :'atl');

-- Team rows and sessions, as the runner.
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select tests.make_admin(:'gone') as gone_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
update admin_members set status = 'removed', removed_at = now() where user_id = :'gone';
insert into admin_members (user_id, role, status) values (:'invited', 'support', 'invited');
-- Only this test's team counts: any other row (another test's, left in the
-- local database) is marked removed, in this transaction only.
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup', :'gone', :'invited');
-- A session that passed only the emailed code, and one for a customer.
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'owner', 'aal1', now(), now()) returning id as owner_aal1 \gset
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'cust', 'aal2', now(), now()) returning id as cust_session \gset

-- ---------------------------------------------------------------------------
-- 1. admin_role(): live, and only on a current session that passed the second factor
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is(admin_role(), 'owner', '1a. an active owner on a current aal2 session: owner');
select ok(is_admin() and is_owner(), '1b. ...is_admin() and is_owner()');
select tests.authenticate_as(:'owner', null, 'aal1', :'owner_aal1');
select is(admin_role(), null, '1c. the same owner with the emailed code only (aal1): nothing');
select tests.authenticate_as(:'owner', null, 'aal2', gen_random_uuid());
select is(admin_role(), null, '1d. ...or with a session that isn''t current (ended, signed out everywhere)');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select ok(admin_role() = 'support' and is_admin() and not is_owner(), '1e. support: an admin, not an owner');
select tests.authenticate_as(:'gone', null, 'aal2', :'gone_session');
select is(admin_role(), null, '1f. a removed member: nothing, at once, on a session still current');
select tests.authenticate_as(:'invited');
select is(admin_role(), null, '1g. an invited member who hasn''t joined: nothing');
select tests.authenticate_as(:'cust', 'admin', 'aal2', :'cust_session');
select is(admin_role(), null, '1h. a login whose token still says app_metadata.role = admin, but isn''t on the team: nothing');

-- ---------------------------------------------------------------------------
-- 2. Access rules follow it
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select ok((select count(*) from providers) >= 1, '2a. an admin rule lets the owner read every provider');
select tests.authenticate_as(:'owner', null, 'aal1', :'owner_aal1');
select is((select count(*)::int from providers), 0, '2b. ...not with the emailed code only');
select tests.authenticate_as(:'gone', null, 'aal2', :'gone_session');
select is((select count(*)::int from providers), 0, '2c. ...nor a removed member');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select lives_ok($$ update commission_rates set rate_bps = rate_bps where kind = 'service' $$, '2d. the owner changes a commission rate (an admin rule)');

-- ---------------------------------------------------------------------------
-- 3. The server acting for an admin: the session named in the header
-- ---------------------------------------------------------------------------
select tests.authenticate_as_server_for(:'owner');
select is(admin_role_of(:'owner'), 'owner', '3a. the server, naming the owner''s current aal2 session: owner');
select is(admin_role_of(:'sup'), null, '3b. ...but not for someone else with that session');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_aal1')::text, true);
select is(admin_role_of(:'owner'), null, '3c. a session that passed only the emailed code: nothing');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'gone_session')::text, true);
select is(admin_role_of(:'gone'), null, '3d. a removed member''s session: nothing');
select set_config('request.headers', '{}', true);
select is(admin_role_of(:'owner'), null, '3e. no session named: nothing');
select set_config('request.headers', '{"x-lokl-admin-session": "not-a-session"}', true);
select is(admin_role_of(:'owner'), null, '3f. a malformed session: nothing');
-- A signed-in user with a forged header. Without the grant, permissions refuse it.
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select throws_ok(format($$ select admin_role_of(%L) $$, :'owner'), '42501', null,
  '3g. a signed-in user calling it with a forged header is refused (no permission)');
-- With the permission widened by mistake, the function refuses on its own.
select tests.clear_authentication();
grant execute on function public.admin_role_of(uuid) to authenticated;
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select throws_ok(format($$ select admin_role_of(%L) $$, :'owner'), '42501', 'Only lokl''s server can act for an admin.',
  '3h. ...and even with its permission widened by mistake, it refuses anyone but the server');
select throws_ok(format($$ select admin_cancel_booking(gen_random_uuid(), %L, 'Forged header test.', 'confirmed', false, 0, now(), null, null) $$, :'owner'), '42501', null,
  '3i. a server-only admin function, called by a signed-in user with a forged header, is refused');
select tests.clear_authentication();
revoke execute on function public.admin_role_of(uuid) from authenticated;
-- (Not authenticate_as_server_for, which would make them a member again.)
select tests.authenticate_as_service_role();
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'gone_session')::text, true);
select throws_ok(format($$ select admin_set_provider_status((select id from providers where owner_id = %L), %L, 'suspended', 'Removed admin test.', null) $$, :'prov', :'gone'),
  null, null, '3j. the server acting for a removed member is refused by the admin function itself');

-- 3b. Recording what Stripe already did for an admin's cancellation (a lost
-- reply finished by the webhook or a retry): no session, the server says so.
select tests.clear_authentication();
select tests.authenticate_as_service_role();
select set_config('request.headers', '{"x-lokl-finishing": "stripe"}', true);
select ok(admin_finishing_stripe(:'owner') and admin_finishing_stripe(:'gone'),
  '3k. the server recording what Stripe did, for someone who is or was on the team');
select ok(not admin_finishing_stripe(:'cust'), '3l. ...never for someone who was never on the team');
select set_config('request.headers', '{}', true);
select ok(not admin_finishing_stripe(:'owner'), '3m. ...and only when the server says it''s recording what Stripe did');
select tests.clear_authentication();
grant execute on function public.admin_finishing_stripe(uuid) to authenticated;
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select set_config('request.headers', '{"x-lokl-finishing": "stripe"}', true);
select throws_ok(format($$ select admin_finishing_stripe(%L) $$, :'owner'), '42501', 'Only lokl''s server can act for an admin.',
  '3n. a signed-in user with a forged header is refused, even with its permission widened by mistake');
select tests.clear_authentication();
revoke execute on function public.admin_finishing_stripe(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 4. At least one owner, always; never deleted
-- ---------------------------------------------------------------------------
select tests.clear_authentication();
select lives_ok(format($$ update admin_members set status = 'removed', removed_at = now() where user_id = %L $$, :'owner2'),
  '4a. an owner can be removed while another active owner remains');
select throws_ok(format($$ update admin_members set status = 'removed', removed_at = now() where user_id = %L $$, :'owner'), '23514',
  'lokl must always have an owner. Make someone else an owner first.', '4b. the last active owner can''t be removed');
select throws_ok(format($$ update admin_members set role = 'support' where user_id = %L $$, :'owner'), '23514',
  'lokl must always have an owner. Make someone else an owner first.', '4c. ...nor made support');
select tests.authenticate_as_service_role();
select throws_ok(format($$ update admin_members set role = 'support' where user_id = %L $$, :'owner'), '23514', null,
  '4d. ...not even with the server key');
select tests.clear_authentication();
select throws_ok(format($$ delete from admin_members where user_id = %L $$, :'sup'), '23514',
  'Team members are never deleted: remove them instead (their history stays).', '4e. a member is never deleted');
select throws_ok('truncate admin_members', '23514', null, '4f. ...nor the table emptied');

-- ---------------------------------------------------------------------------
-- 5. An admin login never owns a business, both ways
-- ---------------------------------------------------------------------------
select throws_ok(format($$ insert into admin_members (user_id, role, status) values (%L, 'support', 'invited') $$, :'prov'), '23514',
  'This login owns a business, so it can''t be on the team. Use a separate login.', '5a. a login that owns a business can''t join the team');
select throws_ok(format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'Owner''s shop', %L) $$, :'sup', :'atl'), '23514',
  'An admin login can''t own a business. Use a separate login for the provider.', '5b. a team member can''t own a business');
select lives_ok(format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'After leaving', %L) $$, :'gone', :'atl'),
  '5c. once removed from the team, the login may own one');

-- ---------------------------------------------------------------------------
-- 6. Who reads the team; nobody writes it directly
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((select array_agg(user_id) from admin_members), array[:'sup']::uuid[], '6a. support reads only their own row');
select tests.authenticate_as(:'invited');
select is((select status from admin_members), 'invited', '6b. an invited person reads their own row (whether they''ve joined)');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is((select count(*)::int from admin_members), 5, '6c. an owner reads the whole team');
select tests.authenticate_as(:'owner', null, 'aal1', :'owner_aal1');
select is((select count(*)::int from admin_members), 1, '6d. ...but with the emailed code only, just their own row');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ update admin_members set role = 'owner' where user_id = %L $$, :'sup'), '42501', null,
  '6e. not even an owner writes it directly (only the team functions will)');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ update admin_members set role = 'owner' where user_id = %L $$, :'sup'), '42501', null,
  '6f. support can''t change their own role');
select tests.authenticate_as_anon();
select throws_ok('select * from admin_members', '42501', null, '6g. visitors read nothing');

-- ---------------------------------------------------------------------------
-- 7. The preview (the cutover's check)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is(admin_role_preview() ->> 'role', 'owner', '7a. the preview, on the owner''s aal2 session: owner');
select ok((admin_role_preview() ->> 'second_factor_passed')::boolean and admin_role_preview() -> 'member' ->> 'status' = 'active',
  '7b. ...second factor passed, an active member');
select tests.authenticate_as(:'owner', null, 'aal1', :'owner_aal1');
select ok(admin_role_preview() ->> 'role' is null and not (admin_role_preview() ->> 'second_factor_passed')::boolean,
  '7c. on an emailed-code-only session: no role yet, second step still to pass');

select * from finish();
rollback;
