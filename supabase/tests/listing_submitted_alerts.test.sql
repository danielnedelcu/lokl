-- The team is told when a listing is sent for review (migration
-- listing_submitted_alerts): every active team member, owners and support,
-- in the bell and by email, once per submission; nobody invited or
-- removed; nothing for other status changes; each reads only their own
-- bell; a deleted listing takes its bell rows with it, its emails stay.
begin;
\ir _helpers/users.psql
select plan(21);

select tests.create_user('lsa-owner@test.local') as owner \gset
select tests.create_user('lsa-support@test.local') as sup \gset
select tests.create_user('lsa-gone@test.local') as gone \gset
select tests.create_user('lsa-invited@test.local') as invited \gset
select tests.create_user('lsa-provider@test.local') as powner \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select tests.make_admin(:'gone', 'support') as gone_session \gset
update admin_members set status = 'removed', removed_at = now() where user_id = :'gone';
insert into admin_members (user_id, role, status) values (:'invited', 'support', 'invited');
-- Only this test's team counts.
update admin_members set status = 'removed', removed_at = now()
 where status = 'active' and user_id not in (:'owner', :'sup');

select id as atl from cities where slug = 'atlanta' \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'LSA Ward') returning id as area \gset
insert into categories (kind, name, slug) values ('experience', 'LSA food', 'lsa-food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'LSA cuts', 'lsa-cuts') returning id as svc \gset
insert into providers (owner_id, display_name, city_id) values (:'powner', 'LSA Tours', :'atl') returning id as p \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'LSA crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'area')
returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id, booking_mode, duration_minutes)
values (:'p', 'service', :'svc', :'atl', 'LSA studio cut', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'area', 'instant', 60)
returning id as ls \gset
select tests.make_ready(:'le');
select tests.make_ready(:'ls');

create function pg_temp.bell(p_listing uuid) returns text language sql as $$
  select coalesce(string_agg(u.email, ',' order by u.email), '') from public.admin_notifications n join auth.users u on u.id = n.recipient_id
  where n.kind = 'listing_submitted' and n.listing_id = p_listing
$$;
create function pg_temp.mail(p_listing uuid) returns text language sql as $$
  select coalesce(string_agg(u.email, ',' order by u.email), '') from public.admin_emails e join auth.users u on u.id = e.recipient_id
  where e.kind = 'admin_listing_submitted' and e.listing_id = p_listing
$$;

-- ---------------------------------------------------------------------------
-- 1. WHO IS TOLD, AND WHEN
-- ---------------------------------------------------------------------------

-- The provider sends it for review (the website's server writes the status).
select tests.authenticate_as_service_role();
update listings set status = 'submitted' where id = :'le';
select tests.clear_authentication();
select is(pg_temp.bell(:'le'), 'lsa-owner@test.local,lsa-support@test.local', '1a. sent for review: the owner and support each get a bell notice');
select is(pg_temp.mail(:'le'), 'lsa-owner@test.local,lsa-support@test.local', '1b. ...and an email');
select is((select count(*)::int from admin_notifications where recipient_id in (:'gone', :'invited')), 0, '1c. nobody removed or only invited is told');
select is((select count(*)::int from admin_emails where recipient_id in (:'gone', :'invited')), 0, '1d. ...by email either');

update listings set status = 'submitted' where id = :'le';
select is((select count(*)::int from admin_notifications where listing_id = :'le'), 2, '1e. the same status again: nothing new');

-- Sent back, changed, sent again: told again.
update listings set status = 'rejected', rejection_reason = 'The photos are of another tour.' where id = :'le';
update listings set status = 'draft' where id = :'le';
select is((select count(*)::int from admin_notifications where listing_id = :'le'), 2, '1f. sent back or back to a draft: nothing new');
update listings set status = 'submitted' where id = :'le';
select is((select count(*)::int from admin_notifications where listing_id = :'le'), 4, '1g. sent for review again: everyone''s bell again');
select is((select count(*)::int from admin_emails where listing_id = :'le'), 2, '1h. ...but no second email within the hour');
-- An hour on (the earlier emails backdated, triggers off for this session).
set local session_replication_role = replica;
update admin_emails set created_at = created_at - interval '61 minutes' where listing_id = :'le';
set local session_replication_role = origin;
update listings set status = 'rejected', rejection_reason = 'Still the wrong photos, sorry.' where id = :'le';
update listings set status = 'submitted' where id = :'le';
select is((select count(*)::int from admin_notifications where listing_id = :'le'), 6, '1h2. sent again an hour later: the bell again');
select is(pg_temp.mail(:'le'), 'lsa-owner@test.local,lsa-owner@test.local,lsa-support@test.local,lsa-support@test.local', '1h3. ...and the email again, once each');

-- Going live, by review or directly (a Service), tells nobody.
update listings set status = 'live', published_at = now() where id = :'le';
update listings set status = 'live', published_at = now() where id = :'ls';
select is((select count(*)::int from admin_notifications where listing_id in (:'le', :'ls')), 6, '1i. going live (approved, or a Service): nothing new');

-- ---------------------------------------------------------------------------
-- 2. WHAT THE TABLES ALLOW
-- ---------------------------------------------------------------------------

select throws_ok(format($$ insert into admin_notifications (recipient_id, kind) values (%L, 'listing_submitted') $$, :'owner'),
  '23514', NULL, '2a. a listing_submitted bell row must name its listing');
select throws_ok(format($$ insert into admin_notifications (recipient_id, kind, listing_id) values (%L, 'job_alert', %L) $$, :'owner', :'ls'),
  '23514', NULL, '2c. another kind can''t name a listing');
select throws_ok(format($$ insert into admin_emails (kind, recipient_id) values ('admin_listing_submitted', %L) $$, :'owner'),
  '23514', NULL, '2d. an admin_listing_submitted email must name its listing');
select throws_ok(format($$ insert into admin_emails (kind, recipient_id, listing_id) values ('admin_invite', %L, %L) $$, :'owner', :'ls'),
  '23514', NULL, '2e. another kind of email can''t');

-- ---------------------------------------------------------------------------
-- 3. WHO READS THE BELL
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((select count(*)::int from admin_notifications where kind = 'listing_submitted'), 3, '3a. support reads their own three');
select is((select count(*)::int from admin_notifications where recipient_id = :'owner'), 0, '3b. ...not the owner''s');
select tests.authenticate_as(:'powner');
select is((select count(*)::int from admin_notifications), 0, '3c. the provider can''t read the team''s bell');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 4. A DELETED LISTING
-- ---------------------------------------------------------------------------

-- A draft its provider deletes after sending it for review (never published).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'LSA tasting', 'Six bakeries in one morning, with the bakers.', 3000, 90, :'area')
returning id as lt \gset
select tests.make_ready(:'lt');
update listings set status = 'submitted' where id = :'lt';
delete from listings where id = :'lt';
select is((select count(*)::int from admin_notifications where kind = 'listing_submitted' and listing_id is null), 0, '4a. its bell notices go with it');
select is(pg_temp.mail(:'lt'), 'lsa-owner@test.local,lsa-support@test.local', '4b. its emails stay in the outbox (the sender skips them)');
select is((select count(*)::int from admin_notifications where listing_id = :'lt'), 0, '4c. ...and no bell row points at it');

select * from finish();
rollback;
