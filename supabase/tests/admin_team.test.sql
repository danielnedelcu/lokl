-- Admin roles, step 5a (migration admin_team; docs/design/admin-roles.md):
-- what only the owner may do, the team functions, and their alerts.
begin;
\ir _helpers/users.psql
select plan(72);

select tests.create_user('at-owner@test.local') as owner \gset
select tests.create_user('at-owner2@test.local') as owner2 \gset
select tests.create_user('at-support@test.local') as sup \gset
select tests.create_user('at-new@test.local') as new \gset
select tests.create_user('at-lapsed@test.local') as lapsed \gset
select tests.create_user('at-gone@test.local') as gone \gset
select tests.create_user('at-customer@test.local') as cust \gset
select tests.create_user('at-provider@test.local') as prov \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'prov', 'AT Cuts', :'atl');

-- Team rows and sessions, as the runner.
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select tests.make_admin(:'gone', 'support') as gone_session \gset
-- Only this test's team counts: any other row (another test's, left in the
-- local database) is marked removed, in this transaction only.
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup', :'gone');
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'cust', 'aal2', now(), now()) returning id as cust_session \gset
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :'gone', 'phone', 'totp', 'verified', now(), now(), 'x');
insert into guides (market_id, slug, draft_title) values (:'atl', 'at-guide', 'A guide') returning id as g \gset

-- ---------------------------------------------------------------------------
-- 1. Owner-only areas
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select is(is_owner(), false, '1a. is_owner() is false, not null, for someone not on the team');

select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok($$ insert into categories (kind, name, slug) values ('service', 'AT support cat', 'at-support-cat') $$,
  '42501', 'new row violates row-level security policy for table "categories"', '1b. support can''t add a category');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select lives_ok($$ insert into categories (kind, name, slug) values ('service', 'AT owner cat', 'at-owner-cat') $$,
  '1c. the owner can');

select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
update commission_rates set rate_bps = 1 where kind = 'service';
select tests.clear_authentication();
select isnt((select rate_bps from commission_rates where kind = 'service'), 1, '1d. support can''t change a commission rate');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
update commission_rates set rate_bps = 1300 where kind = 'service';
select tests.clear_authentication();
select is((select rate_bps from commission_rates where kind = 'service'), 1300, '1e. the owner can');

select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((select count(*)::int from guides where id = :'g'), 1, '1f. support reads guides');
update guides set draft_title = 'Support''s title' where id = :'g';
select throws_ok(format($$ insert into guides (market_id, slug) values (%L, 'at-support-guide') $$, :'atl'),
  '42501', 'new row violates row-level security policy for table "guides"', '1g. support can''t start a guide');
select tests.clear_authentication();
select is((select draft_title from guides where id = :'g'), 'A guide', '1h. ...or change one');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
update guides set draft_title = 'Owner''s title' where id = :'g';
select tests.clear_authentication();
select is((select draft_title from guides where id = :'g'), 'Owner''s title', '1i. the owner can');

-- The server, acting for support (their session in the header).
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'sup'), '42501', 'Only the owner can publish a guide.',
  '1j. support can''t publish a guide');
select throws_ok(format($$ select unpublish_guide(%L, %L) $$, :'g', :'sup'), '42501', NULL,
  '1k. ...or take one down');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok($$ select admin_set_homepage_features(array[]::uuid[]) $$, '42501', 'Only the owner can choose the homepage''s guides.',
  '1l. support can''t choose the homepage''s guides');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select lives_ok($$ select admin_set_homepage_features(array[]::uuid[]) $$, '1m. the owner can');

-- ---------------------------------------------------------------------------
-- 2. Invite (the server, as the owner)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'Help with support') $$, :'owner', 'AT-NEW@TEST.LOCAL'),
  '42501', 'permission denied for function admin_invite', '2a. not through the API, even for the owner');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'Help with support') $$, :'sup', 'at-new@test.local'),
  '42501', 'Only the owner can invite someone to the team.', '2b. the server acting for support: refused');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select throws_ok(format($$ select admin_invite(%L, %L, 'admin', 'Help with support') $$, :'owner', 'at-new@test.local'),
  '23514', 'Choose a role: owner or support.', '2c. a role that isn''t one');
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'hi') $$, :'owner', 'at-new@test.local'),
  '23514', 'Say why, in a few words.', '2d. a reason is required');
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'Help with support') $$, :'owner', 'at-owner@test.local'),
  '23514', 'You''re on the team already.', '2e. not themselves');
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'Help with support') $$, :'owner', 'at-support@test.local'),
  '23514', 'They''re on the team already.', '2f. not someone already on it');
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'Help with support') $$, :'owner', 'at-provider@test.local'),
  '23514', 'This login owns a business, so it can''t be on the team. Use a separate login.', '2g. not a login that owns a business');
select throws_ok(format($$ select admin_invite(%L, %L, 'support', 'Help with support') $$, :'owner', 'at-nobody@test.local'),
  'P0002', 'There''s no login for that email.', '2h. not an email with no login');
select is(admin_invite(:'owner', ' At-New@test.local ', 'support', '  Help with support  '), :'new'::uuid, '2i. the owner invites someone by email (any case, spaces trimmed)');
select is(admin_invite(:'owner', 'at-lapsed@test.local', 'owner', 'A second owner'), :'lapsed'::uuid, '2j. ...and someone else, as an owner');
select tests.clear_authentication();
select is((select role || '/' || status || '/' || invited_by::text from admin_members where user_id = :'new'),
  'support/invited/' || :'owner', '2k. an invited member, as support, invited by the owner');
select is((select reason || '/' || message from admin_actions where target = 'admin_member' and target_id = :'new' and action = 'invite_admin'),
  'Help with support/as support', '2l. logged, with the reason trimmed and the role');
select is((select count(*)::int from admin_emails e join admin_actions a on a.id = e.admin_action_id
            where a.target_id = :'new' and e.kind = 'admin_invite' and e.recipient_id = :'new'), 1,
  '2m. an invitation emailed to them');
select results_eq(format($$ select e.recipient_id from admin_emails e join admin_actions a on a.id = e.admin_action_id
                             where a.target_id = %L and e.kind = 'admin_team_change' order by 1 $$, :'new'),
  format($$ select x from unnest(array[%L, %L]::uuid[]) x order by 1 $$, :'owner', :'owner2'),
  '2n. every active owner emailed, the one who did it included');
select results_eq(format($$ select n.recipient_id from admin_notifications n join admin_actions a on a.id = n.admin_action_id
                             where a.target_id = %L and n.kind = 'team_change' order by 1 $$, :'new'),
  format($$ select x from unnest(array[%L, %L]::uuid[]) x order by 1 $$, :'owner', :'owner2'),
  '2o. ...and in their bells');
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where a.target_id = :'new' and n.recipient_id in (:'sup', :'new')), 0, '2p. not support''s, nor the invited person''s');

-- ---------------------------------------------------------------------------
-- 3. Join (the invited person, past the second step, within 7 days)
-- ---------------------------------------------------------------------------
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'new', 'aal1', now(), now()) returning id as new_aal1 \gset
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'new', 'aal2', now(), now()) returning id as new_aal2 \gset
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'lapsed', 'aal2', now(), now()) returning id as lapsed_aal2 \gset
update admin_members set invited_at = now() - interval '7 days 1 minute' where user_id = :'lapsed';
select tests.authenticate_as(:'new', null, 'aal1', :'new_aal1');
select throws_ok($$ select admin_join() $$, '42501', 'Set up your authenticator and pass the second step first.',
  '3a. not with the emailed code only');
select tests.authenticate_as(:'new', null, 'aal2', gen_random_uuid());
select throws_ok($$ select admin_join() $$, '42501', 'Set up your authenticator and pass the second step first.',
  '3b. nor on a session that isn''t current');
select tests.authenticate_as(:'lapsed', null, 'aal2', :'lapsed_aal2');
select throws_ok($$ select admin_join() $$, '23514', 'This invitation has lapsed. Ask the owner to send it again.',
  '3c. nor after 7 days');
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select throws_ok($$ select admin_join() $$, 'P0002', 'There''s no invitation for this login.', '3d. nor without an invitation');
select tests.authenticate_as(:'new', null, 'aal2', :'new_aal2');
select is(admin_join(), 'joined', '3e. the invited person joins');
select is(admin_role(), 'support', '3f. ...and is support at once');
select throws_ok($$ select admin_join() $$, 'P0002', 'There''s no invitation for this login.', '3g. once');
select tests.clear_authentication();
select is((select count(*)::int from admin_actions where target_id = :'new' and action = 'join_admin' and admin_id = :'new'), 1,
  '3h. logged');
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where a.target_id = :'new' and a.action = 'join_admin'), 2, '3i. every owner told');
select tests.authenticate_as_anon();
select throws_ok($$ select admin_join() $$, '42501', 'permission denied for function admin_join', '3j. not a visitor');

-- ---------------------------------------------------------------------------
-- 4. Change a role (the owner, through the API)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_change_role(%L, 'owner', 'Promote them') $$, :'new'),
  '42501', 'Only the owner can change a role.', '4a. not support');
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select throws_ok(format($$ select admin_change_role(%L, 'owner', 'Promote them') $$, :'new'),
  '42501', 'Only the owner can change a role.', '4b. not a customer');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select admin_change_role(%L, 'support', 'Step back') $$, :'owner'),
  '23514', 'You can''t change your own role. Ask another owner.', '4c. not their own');
select throws_ok(format($$ select admin_change_role(%L, 'owner', 'Promote them') $$, :'cust'),
  'P0002', 'They''re not on the team.', '4d. not someone not on the team');
select is(admin_change_role(:'new', 'support', 'Same again'), 'unchanged', '4e. the same role: nothing changes');
select is(admin_change_role(:'new', 'owner', 'Promote them'), 'changed', '4f. the owner makes support an owner');
select tests.authenticate_as(:'new', null, 'aal2', :'new_aal2');
select is(admin_role(), 'owner', '4g. ...at once');
select tests.clear_authentication();
select is((select message from admin_actions where target_id = :'new' and action = 'change_admin_role'), 'support to owner',
  '4h. logged with the old and new role');
select is((select count(*)::int from admin_actions where target_id = :'new' and action = 'change_admin_role'), 1,
  '4i. the unchanged call wasn''t logged');

-- ---------------------------------------------------------------------------
-- 5. Reset a second factor, and remove (the owner, through the API)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_reset_second_factor(%L, 'Lost phone') $$, :'gone'),
  '42501', 'Only the owner can reset someone''s second factor.', '5a. support can''t reset a second factor');
select throws_ok(format($$ select admin_remove(%L, 'Left the company') $$, :'gone'),
  '42501', 'Only the owner can remove someone from the team.', '5b. ...or remove someone');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select admin_reset_second_factor(%L, 'Lost phone') $$, :'owner'),
  '23514', 'Change your own authenticators on the Security page.', '5c. not their own second factor');
select throws_ok(format($$ select admin_remove(%L, 'Leaving') $$, :'owner'),
  '23514', 'You can''t remove yourself. Ask another owner.', '5d. not themselves');
select is(admin_reset_second_factor(:'gone', 'Lost phone'), 'reset', '5e. the owner resets someone''s second factor');
select tests.clear_authentication();
select is((select count(*)::int from auth.mfa_factors where user_id = :'gone'), 0, '5f. their authenticators are gone');
select is((select count(*)::int from auth.sessions where user_id = :'gone'), 0, '5g. ...and they''re signed out');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is(admin_remove(:'new', 'Left the company'), 'removed', '5h. the owner removes someone');
select tests.authenticate_as(:'new', null, 'aal2', :'new_aal2');
select is(admin_role(), null, '5i. ...whose admin access ends at once');
select tests.clear_authentication();
select is((select count(*)::int from auth.sessions where user_id = :'new'), 0, '5j. ...signed out everywhere');
select is((select status || '/' || removed_by::text from admin_members where user_id = :'new'), 'removed/' || :'owner',
  '5k. their row kept, marked removed');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select admin_remove(%L, 'Again') $$, :'new'), 'P0002', 'They''re not on the team.', '5l. once');
-- Invited again after removal: back to invited.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_invite(:'owner', 'at-new@test.local', 'support', 'Back again'), :'new'::uuid, '5m. someone removed can be invited again');
select tests.clear_authentication();
select is((select status || '/' || coalesce(removed_at::text, '-') from admin_members where user_id = :'new'), 'invited/-',
  '5n. ...invited, not removed');

-- ---------------------------------------------------------------------------
-- 6. The Team page's list, the outbox and the bell
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is((select role || '/' || status from admin_team() where user_id = :'lapsed'), 'owner/invited', '6a. the owner sees the team');
select ok((select invitation_lapsed from admin_team() where user_id = :'lapsed'), '6b. ...and which invitations have lapsed');
select is((select email from admin_team() where user_id = :'sup'), 'at-support@test.local', '6c. ...with their email');
select ok((select count(*) from admin_emails) > 0, '6d. the owner reads the team''s outbox');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok($$ select * from admin_team() $$, '42501', 'Only the owner can see the team.', '6e. support can''t');
select is((select count(*)::int from admin_emails), 0, '6f. ...nor read the outbox');
select is((select count(*)::int from admin_notifications where kind = 'team_change'), 0, '6g. ...and has no team alerts');
select tests.authenticate_as_anon();
select throws_ok($$ select * from admin_team() $$, '42501', 'permission denied for function admin_team', '6h. not a visitor');
select tests.authenticate_as_service_role();
select throws_ok(format($$ insert into admin_notifications (recipient_id, kind) values (%L, 'team_change') $$, :'owner'),
  '23514', NULL, '6i. a team alert names its logged action');
select throws_ok(format($$ delete from admin_emails where recipient_id = %L $$, :'new'), NULL, NULL,
  '6j. the outbox is never deleted from, even by the server');

select * from finish();
rollback;
