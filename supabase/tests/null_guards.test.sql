-- The helpers check:null-guards trusts never to be null (its NEVER_NULL
-- list; 2026-10-20): each answers false, not null, for every kind of caller
-- that isn't what it asks about, so `if not helper()` can't be skipped.
begin;
\ir _helpers/users.psql
select plan(16);

select tests.create_user('ng-owner@test.local') as owner \gset
select tests.create_user('ng-support@test.local') as sup \gset
select tests.create_user('ng-gone@test.local') as gone \gset
select tests.create_user('ng-invited@test.local') as invited \gset
select tests.create_user('ng-customer@test.local') as cust \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select tests.make_admin(:'gone', 'support') as gone_session \gset
update admin_members set status = 'removed', removed_at = now() where user_id = :'gone';
insert into admin_members (user_id, role, status) values (:'invited', 'support', 'invited');
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'owner', 'aal1', now(), now()) returning id as owner_aal1 \gset
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'cust', 'aal2', now(), now()) returning id as cust_session \gset

-- is_admin() and is_owner(): false, never null.
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select is(is_admin(), false, '1a. a customer: is_admin() is false');
select is(is_owner(), false, '1b. ...is_owner() is false');
select tests.authenticate_as(:'owner', null, 'aal1', :'owner_aal1');
select is(is_admin(), false, '1c. an owner on the emailed code only: is_admin() is false');
select is(is_owner(), false, '1d. ...is_owner() is false');
select tests.authenticate_as(:'gone', null, 'aal2', :'gone_session');
select is(is_admin(), false, '1e. a removed member: is_admin() is false');
select is(is_owner(), false, '1f. ...is_owner() is false');
select tests.authenticate_as(:'invited');
select is(is_admin(), false, '1g. an invited member: is_admin() is false');
select is(is_owner(), false, '1h. ...is_owner() is false');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is(is_owner(), false, '1i. support: is_owner() is false');
select tests.authenticate_as(:'owner', null, 'aal2', gen_random_uuid());
select is(is_owner(), false, '1j. an owner on a session that isn''t current: is_owner() is false');

-- admin_finishing_stripe(): false, never null, for the server without the header or for someone never on the team.
select tests.authenticate_as_service_role();
select set_config('request.headers', '{}', true);
select is(admin_finishing_stripe(:'owner'), false, '2a. the server without x-lokl-finishing: false');
select set_config('request.headers', json_build_object('x-lokl-finishing', 'stripe')::text, true);
select is(admin_finishing_stripe(:'cust'), false, '2b. with it, for a login never on the team: false');
select is(admin_finishing_stripe(null), false, '2c. ...or no id at all: false');
select set_config('request.headers', '{}', true);
select is(admin_finishing_stripe(:'owner'), false, '2d. headers absent: false');

-- admin_refund_limit_cents(): the limit, never null, even with no settings row.
select tests.clear_authentication();
select is(admin_refund_limit_cents(), 15000, '3a. the refund limit');
delete from admin_settings;
select is(admin_refund_limit_cents(), 15000, '3b. ...and its default with no settings row, never null');

select * from finish();
rollback;
