-- Suspending and reinstating a provider (admin_set_provider_status): the
-- status, the logged action with its internal reason, and the provider's
-- email with lokl's optional message, together and once; who can see the
-- emails; and that a suspended provider still reads their own bookings.
begin;
\ir _helpers/users.psql
select plan(18);

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('admin@test.local') as admin \gset
-- The admin login carries the role, as CLAUDE.md's grant sets it.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = :'admin';
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'o4w', 'submitted')
returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text) values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'le';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 5) returning id as s1 \gset

select tests.authenticate_as_service_role();
select (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'b';

-- 1. Suspending: the status, the action with its reason, the email with the message.
select is(admin_set_provider_status(:'p', 'suspended', :'admin', 'Several no-show reports this month.', '  Please call us about the last two bookings.  '), true,
  '1a. lokl suspends the provider');
select is((select status from providers where id = :'p'), 'suspended', '1b. ...the provider is suspended');
select is((select reason || ' / ' || message from admin_actions where target_id = :'p' and action = 'suspend_provider'),
  'Several no-show reports this month. / Please call us about the last two bookings.', '1c. ...the action is logged with the internal reason and the message');
select is((select kind || ' / ' || message from provider_emails where provider_id = :'p'),
  'provider_account_paused / Please call us about the last two bookings.', '1d. ...and the "paused" email is queued with the message, not the reason');
select is((select admin_action_id from provider_emails where provider_id = :'p'), (select id from admin_actions where target_id = :'p' and action = 'suspend_provider'),
  '1e. ...one email for that action');

-- 2. Suspending again changes nothing and sends nothing.
select is(admin_set_provider_status(:'p', 'suspended', :'admin', 'Suspending again by mistake.', null), false, '2a. suspending an already suspended provider changes nothing');
select is((select count(*)::int from provider_emails where provider_id = :'p'), 1, '2b. ...and queues no second email');

-- 3. A suspended provider still reads their own bookings (to see and cancel them).
select tests.authenticate_as(:'owner');
select is((select count(*)::int from bookings where id = :'b'), 1, '3. a suspended provider can still read their own bookings');
select tests.authenticate_as_service_role();

-- 4. Reinstating; a blank message is no message.
select is(admin_set_provider_status(:'p', 'active', :'admin', 'Spoke to them; it''s resolved.', '   '), true, '4a. lokl reinstates the provider');
select is((select kind from provider_emails where provider_id = :'p' order by created_at desc limit 1), 'provider_account_active', '4b. ...the "active again" email is queued');
select is((select message from provider_emails where provider_id = :'p' order by created_at desc limit 1), null, '4c. ...a blank message is left out');

-- 5. A reason is required; without one nothing changes (one transaction).
select throws_ok(format($$ select admin_set_provider_status(%L, 'suspended', %L, 'no', null) $$, :'p', :'admin'),
  '23514', NULL, '5a. suspending needs a reason of a few words');
select is((select status from providers where id = :'p'), 'active', '5b. ...and without one the provider isn''t suspended');

-- 5c. The admin id passed in must be an admin's (a second line of defence).
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_set_provider_status(%L, 'suspended', %L, 'Not an admin, though.', null) $$, :'p', :'owner'),
  '42501', 'Only an admin can suspend or reinstate a provider.', '5c. an id that isn''t an admin''s is refused');
select is((select status from providers where id = :'p'), 'active', '5d. ...and nothing changes');

-- 6. Only the server: not signed-in users, not even an admin directly; admins read the emails.
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ select admin_set_provider_status(%L, 'suspended', %L, 'Trying it directly.', null) $$, :'p', :'admin'),
  '42501', NULL, '6a. even an admin can''t call it directly (only the website''s server does)');
select is((select count(*)::int from provider_emails), 2, '6b. the admin reads the provider emails');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from provider_emails), 0, '6c. the provider doesn''t');

select * from finish();
rollback;
