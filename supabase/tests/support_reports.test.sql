-- Problem reports (migration support_reports; docs/design/problem-reports.md):
-- who may see and do what, the thread and its effects, the guards, the bells
-- and emails, the limits (Safety never refused), the lists, and that no
-- message text reaches Realtime. Each rule with an allowed and a refused case.
begin;
\ir _helpers/users.psql
select plan(81);

select tests.create_user('sr-owner@test.local') as owner \gset
select tests.create_user('sr-other@test.local') as other \gset
select tests.create_user('sr-cust@test.local') as cust \gset
select tests.create_user('sr-admin1@test.local') as a1 \gset
select tests.create_user('sr-admin2@test.local') as a2 \gset
-- Two admin logins (the bell and the emails go to each).
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id in (:'a1', :'a2');
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Report Studio', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'other', 'Other Studio', :'atl') returning id as q \gset
insert into categories (kind, name, slug) values ('experience', 'Report walks', 'sr-walks') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Report Ward') returning id as area \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'cat', :'atl', 'Report walk', 'A listing made for the problem report tests.', 3000, 60, :'area', 'submitted') returning id as lp \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'q', 'experience', :'cat', :'atl', 'Other walk', 'A listing made for the problem report tests.', 3000, 60, :'area', 'submitted') returning id as lq \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'lp', :'lq');
update listings set status = 'live', published_at = now() where id in (:'lp', :'lq');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'lp', now() + interval '7 days', 20) returning id as sp \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'lq', now() + interval '7 days', 20) returning id as sq \gset
select tests.authenticate_as_service_role();
select (reserve_experience_booking(:'sp', :'cust', 1::smallint, 'Sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id as bp \gset
select (reserve_experience_booking(:'sq', :'cust', 1::smallint, 'Sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id as bq \gset
select tests.clear_authentication();

-- 1. Reporting.
select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into support_reports (category, description, booking_id) values ('booking', 'The customer arrived but the booking says expired.', %L) $$, :'bp'),
  '1a. a provider reports a problem about their own booking');
select id as r1 from support_reports where booking_id = :'bp' \gset
select tests.clear_authentication();
select is((select array[provider_id::text, reporter_id::text, status, listing_id::text] from support_reports where id = :'r1'),
  array[:'p', :'owner', 'todo', :'lp'], '1b. as their business, by them, in To do; the booking filled in its listing');
select is((select count(*)::int from support_report_events where report_id = :'r1' and from_status is null and to_status = 'todo' and actor = 'provider'), 1,
  '1c. its sending is in the history');
select is((select array_agg(recipient_id::text order by recipient_id) from admin_notifications where report_id = :'r1' and kind = 'support_new'),
  (select array_agg(id::text order by id) from unnest(array[:'a1', :'a2']::uuid[]) id), '1d. every admin login''s bell');
select is((select count(*)::int from support_emails where report_id = :'r1' and kind = 'admin_support_new' and admin_id in (:'a1', :'a2')), 2,
  '1e. ...and an email to each');
select tests.authenticate_as(:'owner');
select lives_ok($$ insert into support_reports (category, description) values ('safety', 'A customer threatened me at the door last night.') $$,
  '1f. a Safety report');
select id as rs from support_reports where category = 'safety' and provider_id = :'p' \gset
select tests.clear_authentication();
select ok((select urgent from support_reports where id = :'rs')
      and (select count(*) from admin_notifications where report_id = :'rs' and kind = 'support_safety') = 2
      and (select count(*) from support_emails where report_id = :'rs' and kind = 'admin_support_safety') = 2,
  '1g. ...is urgent, and every admin is told it''s a safety report');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into support_reports (category, description, listing_id) values ('listing', 'Something is wrong with this listing page.', %L) $$, :'lq'),
  '23514', 'That listing isn''t one of yours.', '1h. not about another business''s listing');
select throws_ok(format($$ insert into support_reports (category, description, booking_id) values ('booking', 'Something is wrong with this booking here.', %L) $$, :'bq'),
  '23514', 'That booking isn''t one of yours.', '1i. ...or booking');
select throws_ok(format($$ insert into support_reports (provider_id, category, description) values (%L, 'other', 'Reporting as another business entirely.') $$, :'q'),
  '42501', null, '1j. a provider can''t report as another business (no grant on provider_id)');
select throws_ok($$ insert into support_reports (category, description, status) values ('other', 'Trying to start in progress already.', 'in_progress') $$,
  '42501', null, '1k. ...or set the status');
select throws_ok($$ insert into support_reports (category, description) values ('other', 'Too short.') $$,
  '23514', null, '1l. what happened needs at least 20 characters');
select tests.authenticate_as(:'cust');
select throws_ok($$ insert into support_reports (category, description) values ('other', 'A customer trying to report a problem.') $$,
  '23514', 'Only a business can report a problem.', '1m. a customer can''t (yet)');

-- 2. Who sees what.
select tests.authenticate_as(:'other');
select is((select count(*)::int from support_reports), 0, '2a. another provider sees none of them');
select is((select count(*)::int from support_report_events), 0, '2b. ...nor their history');
select tests.authenticate_as(:'cust');
select is((select count(*)::int from support_reports), 0, '2c. a customer sees none');
select tests.authenticate_as_anon();
select throws_ok('select * from support_reports', '42501', null, '2d. a visitor can''t read them at all');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from support_reports), 2, '2e. the provider sees their own');
select tests.authenticate_as_admin(:'a1');
select is((select count(*)::int from support_reports), 2, '2f. an admin sees every report');

-- 3. The thread.
select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into support_messages (report_id, body) values (%L, 'Adding: it happened twice this week.') $$, :'r1'),
  '3a. the provider adds to their report');
select tests.clear_authentication();
select is((select array[author_kind, author_id::text] from support_messages where report_id = :'r1'), array['provider', :'owner'],
  '3b. ...as themselves');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into support_messages (report_id, body, author_kind) values (%L, 'Pretending to be lokl.', 'admin') $$, :'r1'),
  '42501', null, '3c. a provider can''t write as lokl');
select tests.authenticate_as(:'other');
select throws_ok(format($$ insert into support_messages (report_id, body) values (%L, 'Writing on someone else''s report.') $$, :'r1'),
  '42501', null, '3d. another provider can''t write on it');
-- lokl replies (the server, naming the admin) and waits for the provider.
select tests.authenticate_as_service_role();
select lives_ok(format($$ insert into support_messages (report_id, body, author_kind, author_id) values (%L, 'Thanks. Which day did this happen?', 'admin', %L) $$, :'r1', :'a1'),
  '3e. lokl replies');
select throws_ok(format($$ insert into support_messages (report_id, body, author_kind) values (%L, 'From nobody.', 'admin') $$, :'r1'),
  '23514', 'Say who wrote the message.', '3f. ...always naming who');
update support_reports set status = 'waiting', status_changed_by = 'admin', status_changed_by_id = :'a1' where id = :'r1';
select tests.clear_authentication();
select ok((select count(*) = 1 from notifications where support_report_id = :'r1' and kind = 'support_reply' and provider_id = :'p')
      and (select count(*) = 1 from support_emails where report_id = :'r1' and kind = 'provider_support_reply' and provider_id = :'p'),
  '3g. the provider''s bell and email');
select is((select last_message_from from support_reports where id = :'r1'), 'admin', '3h. the report knows who wrote last');
select tests.authenticate_as(:'owner');
select lives_ok(format($$ insert into support_messages (report_id, body) values (%L, 'It was Tuesday evening, about 6.') $$, :'r1'),
  '3i. the provider answers');
select tests.clear_authentication();
select is((select array[status, status_changed_by] from support_reports where id = :'r1'), array['in_progress', 'provider'],
  '3j. ...which brings a report waiting on them back to In progress');
select is((select count(*)::int from admin_notifications where report_id = :'r1' and kind = 'support_reply'), 4,
  '3k. ...and each of the provider''s two messages told every admin');

-- 4. Closing and reopening.
select tests.authenticate_as(:'owner');
select lives_ok(format($$ update support_reports set status = 'done' where id = %L $$, :'r1'), '4a. "This is sorted": the provider closes their report');
select tests.clear_authentication();
select is((select array[status, status_changed_by, (resolved_at is not null)::text] from support_reports where id = :'r1'), array['done', 'provider', 'true'],
  '4b. ...recorded as theirs, with when');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ update support_reports set status = 'done' where id = %L $$, :'rs'),
  '23514', 'Only lokl can close a safety report.', '4c. not a Safety report');
select throws_ok(format($$ update support_reports set status = 'in_progress' where id = %L $$, :'rs'),
  '23514', 'You can only mark your report as sorted.', '4d. a provider can''t move a report anywhere else');
select throws_ok(format($$ update support_reports set description = 'Changing what I said before, after the fact.' where id = %L $$, :'r1'),
  '42501', null, '4e. ...or change what they reported');
select lives_ok(format($$ insert into support_messages (report_id, body) values (%L, 'Actually it happened again today.') $$, :'r1'),
  '4f. a reply to a report resolved in the last 30 days');
select tests.clear_authentication();
select is((select array[status, (resolved_at is null)::text] from support_reports where id = :'r1'), array['todo', 'true'], '4g. ...reopens it (To do)');
-- Resolved 31 days ago: a reply is refused; a new report follows on from it.
set local session_replication_role = replica;
update support_reports set status = 'done', resolved_at = now() - interval '31 days' where id = :'r1';
set local session_replication_role = origin;
select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into support_messages (report_id, body) values (%L, 'Is anyone still looking at this?') $$, :'r1'),
  '23514', 'This report was resolved over 30 days ago. Start a new report about this.', '4h. resolved over 30 days ago: no reply');
select lives_ok(format($$ insert into support_reports (category, description, follows_report_id) values ('booking', 'The same problem is back again this week.', %L) $$, :'r1'),
  '4i. ...a new report following on from it');
select tests.authenticate_as(:'other');
select throws_ok(format($$ insert into support_reports (category, description, follows_report_id) values ('other', 'Following on from someone else''s report.', %L) $$, :'r1'),
  '23514', 'That report isn''t one of yours.', '4j. not following another business''s report');

-- 5. Moving on the board (the server, for an admin), and what never changes.
select tests.authenticate_as_service_role();
select lives_ok(format($$ update support_reports set status = 'in_progress', status_changed_by = 'admin', status_changed_by_id = %L where id = %L $$, :'a1', :'rs'),
  '5a. an admin moves a report');
select tests.clear_authentication();
select is((select count(*)::int from support_report_events where report_id = :'rs' and to_status = 'in_progress' and actor = 'admin' and actor_id = :'a1'), 1,
  '5b. ...in its history, as that admin');
select tests.authenticate_as_service_role();
select throws_ok(format($$ update support_reports set description = 'Rewritten by the server after the fact.' where id = %L $$, :'rs'),
  '23514', 'A report''s details can''t be changed.', '5c. not even the server changes what was reported');
select throws_ok(format($$ delete from support_reports where id = %L $$, :'rs'), '23514', 'Problem reports are never deleted.', '5d. a report is never deleted');
select throws_ok('truncate support_reports cascade', '42501', null, '5e. no API role may truncate them');
select tests.clear_authentication();
select throws_ok('truncate support_reports cascade', '23514', 'Problem reports are never deleted.', '5e2. ...and the owner is refused by the guard');
select tests.authenticate_as_service_role();
select throws_ok(format($$ update support_messages set body = 'Edited.' where report_id = %L $$, :'r1'), '23514', null, '5f. a message is never edited');
select throws_ok(format($$ delete from support_messages where report_id = %L $$, :'r1'), '23514', null, '5g. ...or deleted');
select throws_ok(format($$ delete from support_report_events where report_id = %L $$, :'r1'), '23514', null, '5h. the history is never deleted');

-- 6. Notes: admins only.
select lives_ok(format($$ insert into support_notes (report_id, admin_id, body) values (%L, %L, 'Called the provider; they''re safe.') $$, :'rs', :'a1'),
  '6a. an admin''s private note (through the server)');
select throws_ok(format($$ update support_notes set body = 'Changed.' where report_id = %L $$, :'rs'), '23514', null, '6b. a note is never changed');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from support_notes), 0, '6c. the provider never sees a note');
select throws_ok(format($$ insert into support_notes (report_id, body) values (%L, 'A provider writing a note.') $$, :'rs'), '42501', null,
  '6d. ...or writes one');
select tests.authenticate_as_admin(:'a2');
select is((select count(*)::int from support_notes), 1, '6e. admins read them');

-- 7. The admin bell: each admin's own.
select tests.authenticate_as_admin(:'a1');
select is((select count(*)::int from admin_notifications where recipient_id <> :'a1'), 0, '7a. an admin reads only their own bell');
select lives_ok($$ update admin_notifications set read_at = now() $$, '7b. ...and marks it read');
select throws_ok($$ update admin_notifications set read_at = null $$, '42501', null, '7c. ...but never unread');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from admin_notifications), 0, '7d. a provider sees no admin''s bell');

-- 8. The email outbox: only delivery details change; never deleted.
select tests.authenticate_as_service_role();
select lives_ok(format($$ update support_emails set status = 'sent', sent_at = now() where report_id = %L $$, :'r1'), '8a. the sender records delivery');
select throws_ok(format($$ update support_emails set kind = 'admin_support_reply' where report_id = %L $$, :'r1'), '23514', null, '8b. ...and nothing else');
select tests.clear_authentication();

-- 9. Limits: 10 reports and 50 messages a day; Safety never refused.
select tests.authenticate_as(:'owner');
do $$ begin
  while (select count(*) from public.support_reports where category <> 'safety') < 10 loop
    insert into public.support_reports (category, description) values ('website', 'The website did something odd again today.');
  end loop;
end $$;
select throws_ok($$ insert into support_reports (category, description) values ('website', 'One more report about the website today.') $$,
  '23514', 'You''ve sent a lot of reports today.', '9a. the 11th report in a day is refused');
select lives_ok($$ insert into support_reports (category, description) values ('safety', 'Someone followed me after the session tonight.') $$,
  '9b. ...but never a Safety report');
select id as rw from support_reports where category = 'website' limit 1 \gset
do $$ begin
  while (select count(*) from public.support_messages where author_kind = 'provider') < 50 loop
    insert into public.support_messages (report_id, body) values ((select id from public.support_reports where category = 'website' limit 1), 'And another thing.');
  end loop;
end $$;
select throws_ok(format($$ insert into support_messages (report_id, body) values (%L, 'The 51st message today.') $$, :'rw'),
  '23514', 'You''ve sent a lot of messages today.', '9c. the 51st message in a day is refused');
select lives_ok(format($$ insert into support_messages (report_id, body) values (%L, 'Still here, still worried.') $$, :'rs'),
  '9d. ...but never on a Safety report');

-- 10. The lists.
select is((my_support_reports() ->> 'total')::int, (select count(*)::int from support_reports), '10a. the provider''s list counts all their reports');
select is(jsonb_array_length(my_support_reports(1, 5) -> 'rows'), 5, '10b. ...a page at a time');
select tests.authenticate_as(:'other');
select is((my_support_reports() ->> 'total')::int, 0, '10c. another provider''s list is empty');
select throws_ok('select admin_support_board()', '42501', 'Admins only.', '10d. only admins read the board');
select tests.authenticate_as_admin(:'a1');
select is((admin_support_board() -> 'columns' -> 'todo' -> 'rows' -> 0 ->> 'urgent')::boolean, true, '10e. the board: urgent first in To do');
select is((admin_support_board() -> 'columns' -> 'in_progress' ->> 'total')::int, 1, '10f. ...each column with its total');
select is((select array[(d ->> 'open_reports')::int, (d ->> 'urgent_reports')::int] from (select admin_dashboard() d) x),
  (select array[count(*) filter (where status <> 'done')::int, count(*) filter (where status <> 'done' and urgent)::int] from support_reports),
  '10g. the dashboard counts open reports, and the urgent ones');

-- The board's search: the admin searches' words, % and _ literal.
select tests.authenticate_as(:'owner');
insert into support_reports (category, description) values ('safety', 'They asked for a 100% refund_now in cash, angrily.');
select tests.authenticate_as_admin(:'a1');
select is((select count(*)::int from jsonb_array_elements(admin_support_board(p_q => '100%') -> 'columns' -> 'todo' -> 'rows')), 1,
  '10h. searching "100%" finds the report that says it, and only that one');
select is((admin_support_board(p_q => '1_0') -> 'columns' -> 'todo' ->> 'total')::int, 0, '10i. "_" is a literal underscore, not any character');
select is((admin_support_board(p_q => 'report studio refund') -> 'columns' -> 'todo' ->> 'total')::int, 1, '10j. every word, in the business name or what happened');
-- A column never stops quietly: it pages.
select is((select array[(c ->> 'total')::int, jsonb_array_length(c -> 'rows'), (c ->> 'page_size')::int]
             from (select admin_support_board(p_column => 'todo', p_page_size => 2) -> 'columns' -> 'todo' c) x),
  array[(select count(*)::int from support_reports where status = 'todo'), 2, 2], '10k. a column''s page, with its total');
select is((select count(*)::int from (
    select jsonb_array_elements(admin_support_board(p_column => 'todo', p_page => g, p_page_size => 2) -> 'columns' -> 'todo' -> 'rows') ->> 'id' as id
      from generate_series(1, 20) g) x),
  (select count(*)::int from support_reports where status = 'todo'), '10l. ...and every page together holds each report once');
select is((select count(*)::int from (
    select distinct jsonb_array_elements(admin_support_board(p_column => 'todo', p_page => g, p_page_size => 2) -> 'columns' -> 'todo' -> 'rows') ->> 'id'
      from generate_series(1, 20) g) x),
  (select count(*)::int from support_reports where status = 'todo'), '10m. ...with none twice');
select tests.clear_authentication();
set local session_replication_role = replica;
update support_reports set resolved_at = now() - interval '90 days' where id = :'r1';
set local session_replication_role = origin;
select tests.authenticate_as_admin(:'a1');
select ok((admin_support_board(p_column => 'done', p_done_days => null) -> 'columns' -> 'done' ->> 'total')::int
          > (admin_support_board(p_column => 'done') -> 'columns' -> 'done' ->> 'total')::int,
  '10n. Done: the last 30 days, and all of them for "See all done"');
select throws_ok($$ select admin_support_board(p_column => 'archive') $$, '22023', 'Unknown column: archive', '10o. an unknown column is refused');

-- 11. The provider's bell, and Realtime.
select tests.clear_authentication();
select throws_ok(format($$ insert into notifications (provider_id, kind) values (%L, 'support_reply') $$, :'p'), '23514', null,
  '11a. a reply notification names its report');
select is((select array_agg(tablename::text order by tablename) from pg_publication_tables
            where pubname = 'supabase_realtime' and tablename in ('admin_notifications', 'notifications', 'support_messages', 'support_notes', 'support_reports')),
  array['admin_notifications', 'notifications'], '11b. Realtime carries only the bells (ids), never messages, notes or reports');

select * from finish();
rollback;
