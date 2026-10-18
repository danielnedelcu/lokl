-- Problem reports, the admin's side (migration support_admin_actions;
-- docs/design/problem-reports.md, phase 3): the admin's reply (and "Reply and
-- wait"), moves between columns and private notes, each only through the
-- server's functions, recorded with the admin as the actor and logged in
-- admin_actions (ids only). Each rule with an allowed and a refused case.
begin;
\ir _helpers/users.psql
select plan(32);

select tests.create_user('sa-owner@test.local') as owner \gset
select tests.create_user('sa-admin@test.local') as admin \gset
select tests.create_user('sa-admin2@test.local') as admin2 \gset
select tests.create_user('sa-cust@test.local') as cust \gset
-- Admins are team members now (admin_members; docs/design/admin-roles.md).
select tests.make_admin(:'admin');
select tests.make_admin(:'admin2');
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Admin Side Studio', :'atl') returning id as p \gset
insert into support_reports (provider_id, category, description) values (:'p', 'payments', 'My payout for last week has not arrived.') returning id as r \gset
insert into support_reports (provider_id, category, description) values (:'p', 'safety', 'A customer threatened me at the door.') returning id as rs \gset

-- 1. Only the server calls the admin's functions.
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ select admin_support_reply(%L, %L, 'Hello from an admin token.') $$, :'r', :'admin'), '42501',
  'permission denied for function admin_support_reply', '1a. an admin''s own token can''t reply directly (the website does)');
select throws_ok(format($$ select admin_support_move(%L, %L, 'done') $$, :'r', :'admin'), '42501',
  'permission denied for function admin_support_move', '1b. ...nor move a report');
select throws_ok(format($$ select admin_support_note(%L, %L, 'A note.') $$, :'r', :'admin'), '42501',
  'permission denied for function admin_support_note', '1c. ...nor add a note');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ select admin_support_move(%L, %L, 'done') $$, :'r', :'admin'), '42501',
  'permission denied for function admin_support_move', '1d. a provider can''t either');
select throws_ok(format($$ select support_column_name('todo') $$), '42501',
  'permission denied for function support_column_name', '1e. the words helper isn''t callable through the API');
select tests.authenticate_as_server_for(:'admin');

-- 2. Who and what.
select throws_ok(format($$ select admin_support_reply(%L, %L, 'Pretending to be lokl.') $$, :'r', :'owner'), '42501',
  'Admins only.', '2a. the server refuses a login that isn''t an admin');
select throws_ok(format($$ select admin_support_move(%L, %L, 'done') $$, gen_random_uuid(), :'admin'), 'P0002',
  'We couldn''t find that report.', '2b. ...and a report that doesn''t exist');
select throws_ok(format($$ select admin_support_reply(%L, %L, '   ') $$, :'r', :'admin'), '23514', null,
  '2c. an empty reply is refused');

-- 3. A reply, and "Reply and wait".
select is(admin_support_reply(:'r', :'admin', 'Thanks: we are checking with Stripe.'), 'todo', '3a. a plain reply leaves the column as it is');
select tests.clear_authentication();
select is((select author_kind || ':' || (author_id = :'admin')::text from support_messages where report_id = :'r'), 'admin:true',
  '3b. the reply is lokl''s, naming the admin');
select is((select count(*)::int from notifications where support_report_id = :'r' and kind = 'support_reply'), 1, '3c. the provider''s bell is told');
select is((select count(*)::int from support_emails where report_id = :'r' and kind = 'provider_support_reply'), 1, '3d. ...and an email queued');
select is((select action from admin_actions where target = 'support_report' and target_id = :'r'), 'support_reply', '3e. logged as a reply');
select is((select reason || message || rule from admin_actions where target_id = :'r'), null, '3f. the log holds ids only, not the reply');
select tests.authenticate_as_server_for(:'admin');
select is(admin_support_reply(:'r', :'admin', 'Which day was it due?', true), 'waiting', '3g. "Reply and wait" moves it to Waiting on provider');
select tests.clear_authentication();
select is((select actor || ':' || (actor_id = :'admin')::text from support_report_events where report_id = :'r' and to_status = 'waiting'), 'admin:true',
  '3h. the history names the admin');
select is((select count(*)::int from admin_actions where target_id = :'r' and action = 'support_reply_wait'), 1, '3i. logged as a reply and wait');

-- 4. Moving.
select tests.authenticate_as_server_for(:'admin');
select is(admin_support_move(:'r', :'admin', 'in_progress', 'waiting'), 'in_progress', '4a. an admin moves a report from the column they saw it in');
-- (The server acts for whichever admin pressed: here the second.)
select tests.authenticate_as_server_for(:'admin2');
select throws_ok(format($$ select admin_support_move(%L, %L, 'done', 'waiting') $$, :'r', :'admin2'), '23514',
  'Someone else moved it to In progress first. The board now shows where it is.', '4b. a move from a column it has left is refused, saying where it is');
select tests.authenticate_as_server_for(:'admin');
select throws_ok(format($$ select admin_support_move(%L, %L, 'in_progress') $$, :'r', :'admin'), '23514',
  'It''s already in In progress.', '4c. a move to its own column is refused');
select throws_ok(format($$ select admin_support_move(%L, %L, 'archive') $$, :'r', :'admin'), '23514',
  'Choose a column: To do, In progress, Waiting on provider or Done.', '4d. an unknown column is refused');
select tests.authenticate_as_server_for(:'admin2');
select is(admin_support_move(:'rs', :'admin2', 'done'), 'done', '4e. an admin closes a Safety report');
select tests.clear_authentication();
select ok((select resolved_at is not null and status_changed_by = 'admin' and status_changed_by_id = :'admin2' from support_reports where id = :'rs'),
  '4f. ...recorded as that admin''s, with the time it was resolved');
select is((select count(*)::int from admin_actions where target = 'support_report' and action = 'support_move'), 2, '4g. each move is logged');
select tests.authenticate_as_server_for(:'admin');
select is(admin_support_move(:'rs', :'admin', 'todo', 'done'), 'todo', '4h. an admin reopens one');
select tests.clear_authentication();
select is((select resolved_at from support_reports where id = :'rs'), null, '4i. ...which is no longer resolved');

-- 5. Notes: private, and logged.
select tests.authenticate_as_server_for(:'admin');
select isnt(admin_support_note(:'r', :'admin', 'Called Stripe; payout is in transit.'), null, '5a. an admin adds a note');
select tests.clear_authentication();
select is((select (admin_id = :'admin')::text from support_notes where report_id = :'r'), 'true', '5b. the note names its admin');
select is((select count(*)::int from admin_actions where target_id = :'r' and action = 'support_note'), 1, '5c. it is logged');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from support_notes where report_id = :'r'), 0, '5d. the provider never sees it');
select tests.authenticate_as_admin(:'admin2');
select is((select count(*)::int from support_notes where report_id = :'r'), 1, '5e. another admin does');

-- 6. Still a log.
select tests.authenticate_as_server_for(:'admin');
select throws_ok(format($$ update admin_actions set action = 'support_note' where target_id = %L $$, :'rs'), '23514',
  'admin_actions is a record of what happened: rows can''t be changed or deleted.',
  '6. the admin''s actions on reports can''t be changed afterwards');

select * from finish();
rollback;
