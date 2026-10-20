-- Append-only logs (migration append_only_logs): the six logs are only ever
-- added to, by everyone including the server and the database owner; an
-- `on delete set null` key may still clear its column; the email outboxes
-- change only their delivery details; bookings and their money are never
-- deleted; local clean-up in replica mode still works; and the
-- anonymisation procedure (guard off, update, guard on) works, with
-- assert_log_guards_on() catching a guard left off.
begin;
\ir _helpers/users.psql
select plan(68);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner, the database owner)
-- ---------------------------------------------------------------------------

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('gone.admin@test.local') as gone \gset
select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Peach Tours', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into categories (kind, name, slug) values ('experience', 'Old category', 'old-category') returning id as oldcat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old area') returning id as oldarea \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'cat', :'atl', 'Taco crawl', 'A listing made for the append-only tests.', 5000, 60, :'o4w', 'draft')
returning id as l \gset
insert into listing_photos (listing_id, storage_path, position, alt_text) values (:'l', :'p' || '/' || :'l' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
select tests.make_ready(id) from listings where id in (:'l');
update listings set status = 'submitted' where id in (:'l');
update listings set status = 'live', published_at = now() where id = :'l';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'l', now() + interval '7 days', 20) returning id as s \gset

-- A booking, made as checkout makes it: its first event is logged.
select tests.authenticate_as_service_role();
select (reserve_experience_booking(:'s', :'cust', 1::smallint, 'Sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b \gset
select tests.clear_authentication();

-- One row in each log, as the runner, with the references a deletion clears.
insert into admin_actions (admin_id, target, target_id, action, reason) values (:'gone', 'booking', :'b', 'cancel_booking', 'The venue closed.') returning id as aa \gset
insert into commission_rate_changes (kind, old_rate_bps, new_rate_bps, changed_by) values ('service', 1200, 1300, :'gone') returning id as crc \gset
insert into guides (market_id, slug, draft_title) values (:'atl', 'append-only-guide', 'Append-only guide') returning id as g \gset
insert into guide_photos (guide_id, storage_path, width, height, alt_text, source) values (:'g', :'g' || '/' || gen_random_uuid() || '.jpg', 2400, 1350, 'Murals', 'own') returning id as photo \gset
insert into guide_versions (guide_id, title, teaser, body, cover_photo_id, area_id, category_id, published_by)
values (:'g', 'Old title', 'Old teaser', '[]', :'photo', :'oldarea', :'oldcat', :'gone') returning id as gv \gset
insert into booking_reports (booking_id, note) values (:'b', 'Nobody was there at all.');
insert into booking_emails (booking_id, kind) values (:'b', 'customer_booking_confirmed') returning id as be \gset
insert into admin_actions (admin_id, target, target_id, action, reason) values (:'admin', 'provider', :'p', 'suspend_provider', 'Paused for review.') returning id as aa2 \gset
insert into provider_emails (provider_id, admin_action_id, kind) values (:'p', :'aa2', 'provider_account_paused') returning id as pe \gset

-- ---------------------------------------------------------------------------
-- 1. THE GUARDS ARE IN PLACE AND ON
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select c.relname || '.' || t.tgname || '|' || t.tgenabled::text
     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
     where p.proname in ('append_only_guard', 'outbox_guard', 'refuse_delete') $$,
  $$ values
       ('admin_actions.admin_actions_append_only|O'), ('admin_actions.admin_actions_append_only_truncate|O'),
       ('booking_events.booking_events_append_only|O'), ('booking_events.booking_events_append_only_truncate|O'),
       ('commission_rate_changes.commission_rate_changes_append_only|O'), ('commission_rate_changes.commission_rate_changes_append_only_truncate|O'),
       ('guide_versions.guide_versions_append_only|O'), ('guide_versions.guide_versions_append_only_truncate|O'),
       ('job_runs.job_runs_append_only|O'), ('job_runs.job_runs_append_only_truncate|O'),
       ('booking_reports.booking_reports_append_only|O'), ('booking_reports.booking_reports_append_only_truncate|O'),
       ('booking_emails.booking_emails_outbox_guard|O'), ('booking_emails.booking_emails_outbox_guard_truncate|O'),
       ('support_messages.support_messages_append_only|O'), ('support_messages.support_messages_append_only_truncate|O'),
       ('support_notes.support_notes_append_only|O'), ('support_notes.support_notes_append_only_truncate|O'),
       ('support_report_events.support_report_events_append_only|O'), ('support_report_events.support_report_events_append_only_truncate|O'),
       ('support_emails.support_emails_outbox_guard|O'), ('support_emails.support_emails_outbox_guard_truncate|O'),
       ('provider_emails.provider_emails_outbox_guard|O'), ('provider_emails.provider_emails_outbox_guard_truncate|O'),
       ('admin_emails.admin_emails_outbox_guard|O'), ('admin_emails.admin_emails_outbox_guard_truncate|O'),
       ('admin_contact_views.admin_contact_views_append_only|O'), ('admin_contact_views.admin_contact_views_append_only_truncate|O'),
       ('bookings.bookings_refuse_delete|O'), ('bookings.bookings_refuse_delete_truncate|O'),
       ('booking_finances.booking_finances_refuse_delete|O'), ('booking_finances.booking_finances_refuse_delete_truncate|O') $$,
  '1a. every guard trigger exists, on its table, switched on');
select lives_ok($$ select public.assert_log_guards_on() $$, '1b. assert_log_guards_on() passes');
select ok(not has_function_privilege('anon', 'public.assert_log_guards_on()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.assert_log_guards_on()', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.assert_log_guards_on()', 'EXECUTE'),
  '1c. ...and no API role can call it (migrations run it as the owner)');

-- ---------------------------------------------------------------------------
-- 2. THE SIX LOGS: ADDED TO, NEVER CHANGED OR DELETED
-- ---------------------------------------------------------------------------

-- Adding still works.
select is((select count(*)::int from booking_events where booking_id = :'b'), 1, '2a. a new booking logs its first event');
select tests.authenticate_as_service_role();
select lives_ok($$ insert into job_runs (job, started_at, checked, changed, failed, failures) values ('pay-out', now(), 3, 1, 1, array['x: failed']) $$,
  '2b. the server logs a job run');
select lives_ok(format($$ insert into admin_actions (admin_id, target, target_id, action) values (%L, 'email', gen_random_uuid(), 'retry_email') $$, :'admin'),
  '2c. ...and an admin action');
select id as jr from job_runs where job = 'pay-out' \gset

-- The server key: no updates, no deletes.
select throws_ok(format($$ update admin_actions set reason = 'Rewritten.' where id = %L $$, :'aa'), '23514',
  'admin_actions is a record of what happened: rows can''t be changed or deleted.', '2d. the server can''t change an admin action');
select throws_ok(format($$ delete from admin_actions where id = %L $$, :'aa'), '23514',
  'admin_actions is a record of what happened: rows can''t be changed or deleted.', '2e. ...or delete one');
select throws_ok(format($$ update booking_events set to_status = 'confirmed' where booking_id = %L $$, :'b'), '23514',
  'booking_events is a record of what happened: rows can''t be changed or deleted.', '2f. the server can''t change a booking event');
select throws_ok(format($$ delete from booking_events where booking_id = %L $$, :'b'), '23514',
  'booking_events is a record of what happened: rows can''t be changed or deleted.', '2g. ...or delete one');
select throws_ok(format($$ update commission_rate_changes set new_rate_bps = 1 where id = %L $$, :'crc'), '23514',
  'commission_rate_changes is a record of what happened: rows can''t be changed or deleted.', '2h. the server can''t change a commission change');
select throws_ok(format($$ delete from commission_rate_changes where id = %L $$, :'crc'), '23514',
  'commission_rate_changes is a record of what happened: rows can''t be changed or deleted.', '2i. ...or delete one');
select throws_ok(format($$ update guide_versions set title = 'Rewritten' where id = %L $$, :'gv'), '23514',
  'guide_versions is a record of what happened: rows can''t be changed or deleted.', '2j. the server can''t change a published guide version');
select throws_ok(format($$ delete from guide_versions where id = %L $$, :'gv'), '23514',
  'guide_versions is a record of what happened: rows can''t be changed or deleted.', '2k. ...or delete one');
select throws_ok(format($$ update job_runs set failed = 0, failures = '{}' where id = %L $$, :'jr'), '23514',
  'job_runs is a record of what happened: rows can''t be changed or deleted.', '2l. the server can''t change a job run');
select throws_ok(format($$ delete from job_runs where id = %L $$, :'jr'), '23514',
  'job_runs is a record of what happened: rows can''t be changed or deleted.', '2m. ...or delete one');
select throws_ok(format($$ update booking_reports set note = 'Rewritten.' where booking_id = %L $$, :'b'), '23514',
  'A problem has already been reported on this booking.', '2n. the server can''t change a problem report (its existing message)');
select throws_ok(format($$ delete from booking_reports where booking_id = %L $$, :'b'), '23514',
  'booking_reports is a record of what happened: rows can''t be changed or deleted.', '2o. ...or now delete one');
select tests.clear_authentication();

-- The database owner: no updates, deletes or truncates either.
select throws_ok(format($$ update admin_actions set reason = 'Rewritten.' where id = %L $$, :'aa'), '23514', null, '2p. the owner can''t change an admin action');
select throws_ok(format($$ delete from admin_actions where id = %L $$, :'aa'), '23514', null, '2q. ...or delete one');
select throws_ok(format($$ delete from booking_events where booking_id = %L $$, :'b'), '23514', null, '2r. the owner can''t delete a booking event');
select throws_ok(format($$ delete from commission_rate_changes where id = %L $$, :'crc'), '23514', null, '2s. ...a commission change');
select throws_ok(format($$ delete from guide_versions where id = %L $$, :'gv'), '23514', null, '2t. ...a guide version');
select throws_ok(format($$ delete from job_runs where id = %L $$, :'jr'), '23514', null, '2u. ...a job run');
select throws_ok(format($$ delete from booking_reports where booking_id = %L $$, :'b'), '23514', null, '2v. ...or a problem report');
select throws_ok($$ truncate admin_actions cascade $$, '23514', 'admin_actions is a record of what happened: rows can''t be changed or deleted.', '2w. the owner can''t truncate admin_actions');
select throws_ok($$ truncate booking_events $$, '23514', null, '2x. ...booking_events');
select throws_ok($$ truncate commission_rate_changes $$, '23514', null, '2y. ...commission_rate_changes');
select throws_ok($$ truncate guide_versions $$, '23514', null, '2z. ...guide_versions');
select throws_ok($$ truncate job_runs $$, '23514', null, '2za. ...job_runs');
select throws_ok($$ truncate booking_reports $$, '23514', null, '2zb. ...or booking_reports');

-- ---------------------------------------------------------------------------
-- 3. A DELETED LOGIN, PHOTO, AREA OR CATEGORY IS CLEARED; NOTHING ELSE CHANGES
-- ---------------------------------------------------------------------------

select lives_ok(format($$ delete from auth.users where id = %L $$, :'gone'), '3a. a login named in the logs can still be deleted');
select is((select admin_id from admin_actions where id = :'aa'), null, '3b. ...the admin action keeps its row, without the login');
select is((select changed_by from commission_rate_changes where id = :'crc'), null, '3c. ...so does the commission change');
select is((select published_by from guide_versions where id = :'gv'), null, '3d. ...and the guide version');
select lives_ok(format($$ delete from guide_photos where id = %L $$, :'photo'), '3e. a photo an old guide version used can still be deleted');
select is((select cover_photo_id from guide_versions where id = :'gv'), null, '3f. ...and the version keeps its row without it');
select lives_ok(format($$ delete from service_areas where id = %L $$, :'oldarea'), '3g. so can an area');
select lives_ok(format($$ delete from categories where id = %L $$, :'oldcat'), '3h. ...and a category');
select is((select row(area_id, category_id, title)::text from guide_versions where id = :'gv'), '(,,"Old title")',
  '3i. ...and the version keeps its row and its words');
select throws_ok(format($$ update guide_versions set area_id = %L where id = %L $$, :'o4w', :'gv'), '23514', null,
  '3j. a cleared reference can''t be set to something else');
select throws_ok(format($$ update admin_actions set admin_id = %L where id = %L $$, :'admin', :'aa'), '23514', null,
  '3k. ...or filled back in');
select throws_ok(format($$ update guide_versions set published_by = null, title = 'Rewritten' where id = %L $$, :'gv'), '23514', null,
  '3l. clearing a reference doesn''t let another column change with it');
select throws_ok(format($$ update admin_actions set target_id = null where id = %L $$, :'aa2'), '23514', null,
  '3m. only the named columns may be cleared (target_id isn''t one)');
select throws_ok(format($$ update job_runs set failures = null where id = %L $$, :'jr'), '23514',
  'job_runs is a record of what happened: rows can''t be changed or deleted.', '3n. ...and a log with none named can''t have anything cleared');

-- ---------------------------------------------------------------------------
-- 4. THE OUTBOXES: ONLY DELIVERY DETAILS CHANGE
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select lives_ok(format($$ update booking_emails set status = 'sending', attempts = 1, locked_at = now() where id = %L $$, :'be'),
  '4a. the server claims a booking email');
select lives_ok(format($$ update booking_emails set status = 'sent', sent_at = now(), resend_id = 'r_1', to_address = 'sam@test.local', last_error = null where id = %L $$, :'be'),
  '4b. ...and records it sent');
select lives_ok(format($$ update booking_emails set status = 'pending', attempts = 0, last_error = null, skip_reason = null, next_attempt_at = now(), locked_at = null where id = %L $$, :'be'),
  '4c. ...and an admin''s "try again" resets it');
select throws_ok(format($$ update booking_emails set kind = 'customer_booking_cancelled' where id = %L $$, :'be'), '23514',
  'booking_emails records which email was sent to whom: only its delivery details can change (not kind).', '4d. which email it is can''t change');
select throws_ok(format($$ update booking_emails set created_at = now() - interval '1 day' where id = %L $$, :'be'), '23514',
  'booking_emails records which email was sent to whom: only its delivery details can change (not created_at).', '4e. ...nor when it was queued');
select throws_ok(format($$ delete from booking_emails where id = %L $$, :'be'), '23514',
  'booking_emails records which email was sent to whom: rows can''t be deleted.', '4f. ...and it can''t be deleted');
select lives_ok(format($$ update provider_emails set status = 'failed', last_error = 'Resend 500: try later' where id = %L $$, :'pe'),
  '4g. the server records a provider email failing');
select throws_ok(format($$ update provider_emails set message = 'Something else.' where id = %L $$, :'pe'), '23514',
  'provider_emails records which email was sent to whom: only its delivery details can change (not message).', '4h. ...but can''t change its message');
select throws_ok(format($$ delete from provider_emails where id = %L $$, :'pe'), '23514',
  'provider_emails records which email was sent to whom: rows can''t be deleted.', '4i. ...or delete it');
select tests.clear_authentication();
select throws_ok($$ truncate booking_emails $$, '23514', null, '4j. the owner can''t truncate booking_emails');
select throws_ok($$ truncate provider_emails $$, '23514', null, '4k. ...or provider_emails');

-- ---------------------------------------------------------------------------
-- 5. BOOKINGS AND THEIR MONEY ARE NEVER DELETED
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select throws_ok(format($$ delete from booking_finances where booking_id = %L $$, :'b'), '23514',
  'booking_finances rows are never deleted: a booking is cancelled instead.', '5a. the server can''t delete a booking''s money');
select throws_ok(format($$ delete from bookings where id = %L $$, :'b'), '23514',
  'bookings rows are never deleted: a booking is cancelled instead.', '5b. ...or the booking');
select tests.clear_authentication();
select throws_ok(format($$ delete from bookings where id = %L $$, :'b'), '23514', null, '5c. nor can the owner');
select throws_ok($$ truncate bookings cascade $$, '23514', null, '5d. ...or truncate bookings');
select throws_ok($$ truncate booking_finances $$, '23514', null, '5e. ...or booking_finances');

-- ---------------------------------------------------------------------------
-- 6. LOCAL CLEAN-UP IN REPLICA MODE STILL WORKS
-- ---------------------------------------------------------------------------

set local session_replication_role = replica;
select lives_ok(format($$ delete from booking_events where booking_id = %L $$, :'b'), '6a. test clean-up (replica mode, the owner only) still deletes');
set local session_replication_role = origin;
select is((select count(*)::int from booking_events where booking_id = :'b'), 0, '6b. ...the rows are gone');

-- ---------------------------------------------------------------------------
-- 7. ANONYMISING ON REQUEST: GUARD OFF, UPDATE, GUARD ON, CHECKED
-- ---------------------------------------------------------------------------

alter table admin_actions disable trigger admin_actions_append_only;
update admin_actions set reason = '[removed on request]' where id = :'aa';
alter table admin_actions enable trigger admin_actions_append_only;
select is((select reason from admin_actions where id = :'aa'), '[removed on request]', '7a. with the guard off, the details are replaced');
select lives_ok($$ select public.assert_log_guards_on() $$, '7b. ...and with it back on, the check passes');
select throws_ok(format($$ update admin_actions set reason = 'Again.' where id = %L $$, :'aa'), '23514', null, '7c. ...and the row is guarded again');

alter table admin_actions disable trigger admin_actions_append_only;
select throws_ok($$ select public.assert_log_guards_on() $$, '23514',
  'These log guards are switched off: admin_actions.admin_actions_append_only. Switch them back on before this migration ends.',
  '7d. a guard left off fails the check, naming it');
alter table admin_actions enable replica trigger admin_actions_append_only;
select throws_ok($$ select public.assert_log_guards_on() $$, '23514', null, '7e. ...as does one set to fire only in replica mode');
alter table admin_actions enable trigger admin_actions_append_only;

select * from finish();
rollback;
