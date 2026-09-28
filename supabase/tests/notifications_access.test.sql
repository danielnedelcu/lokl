-- Notifications: written by the listings trigger on admin status changes,
-- read and marked read only by their provider, deleted with their listing.
-- Every allowed case is paired with the blocked case next to it.
begin;
\ir _helpers/users.psql
select plan(33);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('a@test.local') as a \gset
select tests.create_user('b@test.local') as b \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'a', 'A Tours', :'atl') returning id as pa \gset
insert into providers (owner_id, display_name, city_id) values (:'b', 'B Tours', :'atl') returning id as pb \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

-- A: an Experience in review (la), another in review (lr, to send back),
-- and a draft Service (ls). B: an Experience in review (lb).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'pa', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 150, :'o4w', 'submitted')
returning id as la \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'pa', 'experience', :'exp', :'atl', 'Mural walk', 'Street art of Old Fourth Ward, on foot.', 3000, 90, :'o4w', 'submitted')
returning id as lr \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pa', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'o4w')
returning id as ls \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'pb', 'experience', :'exp', :'atl', 'Jazz night', 'Three clubs on Auburn Avenue.', 4000, 120, :'o4w', 'submitted')
returning id as lb \gset

-- Every listing gets a photo, so it can go live.
insert into listing_photos (listing_id, storage_path, position, alt_text)
select l.id, l.provider_id || '/' || l.id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo of the listing'
from listings l where l.id in (:'la', :'lr', :'ls', :'lb');

-- ---------------------------------------------------------------------------
-- ADMIN TRANSITIONS CREATE ONE NOTIFICATION EACH (as the server)
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

-- 1. Approved: submitted -> live.
update listings set status = 'live', published_at = now() where id = :'la';
select is(
  (select array_agg(kind) from notifications where listing_id = :'la'),
  array['listing_approved'], '1a. approving an Experience notifies its provider once'
);
select is((select provider_id from notifications where listing_id = :'la'), :'pa'::uuid,
  '1b. ...and the notification belongs to the listing''s provider');

-- 2. Taken down: live -> unpublished.
update listings set status = 'unpublished', unpublished_reason = 'The photos show a different business.' where id = :'la';
select is((select count(*)::int from notifications where listing_id = :'la' and kind = 'listing_unpublished'), 1,
  '2. taking a listing down notifies its provider once');

-- 3. Restored: unpublished -> live.
update listings set status = 'live', unpublished_reason = null where id = :'la';
select is((select count(*)::int from notifications where listing_id = :'la' and kind = 'listing_restored'), 1,
  '3. restoring a listing notifies its provider once');

-- 4. Sent back: submitted -> rejected.
update listings set status = 'rejected', rejection_reason = 'Add where to meet.' where id = :'lr';
select is(
  (select array_agg(kind) from notifications where listing_id = :'lr'),
  array['listing_rejected'], '4. sending an Experience back notifies its provider once'
);

-- 5. The provider's own transitions notify nobody.
update listings set status = 'live', published_at = now() where id = :'ls';           -- publish
select is((select count(*)::int from notifications where listing_id = :'ls'), 0, '5a. publishing a Service creates no notification');
update listings set status = 'draft' where id = :'ls';                                 -- unlist
select is((select count(*)::int from notifications where listing_id = :'ls'), 0, '5b. unlisting creates no notification');
update listings set status = 'submitted', rejection_reason = null where id = :'lr';    -- resubmit
select is((select count(*)::int from notifications where listing_id = :'lr'), 1, '5c. resubmitting creates no notification');
update listings set status = 'draft' where id = :'lr';                                 -- unlist from review
select is((select count(*)::int from notifications where listing_id = :'lr'), 1, '5d. unlisting from review creates no notification');

-- 6. Updates that don't change the status notify nobody.
update listings set price_cents = 7000 where id = :'la';
update listings set status = 'live' where id = :'la';
select is((select count(*)::int from notifications where listing_id = :'la'), 3,
  '6. an update that doesn''t change the status creates no notification');

-- B's Experience is approved too, so B has one of their own.
update listings set status = 'live', published_at = now() where id = :'lb';

-- ---------------------------------------------------------------------------
-- READING
-- ---------------------------------------------------------------------------

-- 7. A provider reads their own notifications...
select tests.authenticate_as(:'a');
select is((select count(*)::int from notifications), 4, '7. a provider reads their own notifications (three on la, one on lr)');

-- 8. ...but not another provider's.
select is((select count(*)::int from notifications where provider_id = :'pb'), 0,
  '8. a provider cannot read another provider''s notifications');

-- 9. Signed-out visitors and the admin read none.
select tests.authenticate_as_anon();
select throws_ok('select count(*) from notifications', '42501', 'permission denied for table notifications',
  '9a. a signed-out visitor cannot read notifications');
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from notifications), 0, '9b. the admin reads no notifications');

-- ---------------------------------------------------------------------------
-- MARKING READ
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');
select id as n1 from notifications where listing_id = :'la' and kind = 'listing_approved' \gset

-- 10. A provider can mark their own notification read...
select lives_ok(format($$ update notifications set read_at = now() where id = %L $$, :'n1'),
  '10a. a provider can mark their own notification read');
select isnt((select read_at from notifications where id = :'n1'), null, '10b. ...and it is read');

-- 11. The database sets the time, and keeps the first one.
select read_at::text as first_read from notifications where id = :'n1' \gset
select lives_ok(format($$ update notifications set read_at = '2000-01-01' where id = %L $$, :'n1'),
  '11a. marking it read again is allowed');
select is((select read_at::text from notifications where id = :'n1'), :'first_read',
  '11b. ...and keeps the time already stored, not the browser''s');
select lives_ok(
  format($$ update notifications set read_at = '2000-01-01' where listing_id = %L and kind = 'listing_restored' $$, :'la'),
  '11c. setup: mark another one read with a made-up time');
select ok((select read_at > now() - interval '1 minute' from notifications where listing_id = :'la' and kind = 'listing_restored'),
  '11d. ...which is stored as the database''s time instead');

-- 12. It can't be marked unread.
select throws_ok(format($$ update notifications set read_at = null where id = %L $$, :'n1'),
  '42501', 'new row violates row-level security policy for table "notifications"',
  '12. a provider cannot mark a notification unread');

-- 13. Only read_at can change.
select throws_ok(format($$ update notifications set kind = 'listing_rejected' where id = %L $$, :'n1'),
  '42501', 'permission denied for table notifications', '13a. a provider cannot change a notification''s kind');
select throws_ok(format($$ update notifications set listing_id = %L where id = %L $$, :'ls', :'n1'),
  '42501', 'permission denied for table notifications', '13b. a provider cannot point a notification at another listing');

-- 14. A provider can't mark another provider's notification read.
select tests.clear_authentication();
select id as nb from notifications where provider_id = :'pb' \gset
select tests.authenticate_as(:'a');
with u as (update notifications set read_at = now() where id = :'nb' returning 1)
select is((select count(*)::int from u), 0, '14a. a provider cannot mark another provider''s notification read');
select tests.clear_authentication();
select is((select read_at from notifications where id = :'nb'), null, '14b. ...and it stays unread');

-- ---------------------------------------------------------------------------
-- NOBODY WRITES OR DELETES FROM THE APPS
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 15. A provider can't create or delete notifications.
select throws_ok(
  format($$ insert into notifications (provider_id, kind, listing_id) values (%L, 'listing_approved', %L) $$, :'pa', :'ls'),
  '42501', 'permission denied for table notifications', '15a. a provider cannot create a notification');
select throws_ok(format($$ delete from notifications where id = %L $$, :'n1'),
  '42501', 'permission denied for table notifications', '15b. a provider cannot delete a notification');

-- 16. Nor can the admin or a signed-out visitor.
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  format($$ insert into notifications (provider_id, kind, listing_id) values (%L, 'listing_approved', %L) $$, :'pa', :'ls'),
  '42501', 'permission denied for table notifications', '16a. the admin cannot create a notification');
select throws_ok(format($$ delete from notifications where id = %L $$, :'n1'),
  '42501', 'permission denied for table notifications', '16b. the admin cannot delete a notification');
select tests.authenticate_as_anon();
select throws_ok(
  format($$ insert into notifications (provider_id, kind, listing_id) values (%L, 'listing_approved', %L) $$, :'pa', :'ls'),
  '42501', 'permission denied for table notifications', '16c. a signed-out visitor cannot create a notification');

-- ---------------------------------------------------------------------------
-- DELETED WITH THEIR LISTING
-- ---------------------------------------------------------------------------

-- 17. Deleting a never-published listing (the sent-back Experience, now a
-- draft) deletes its notifications.
select tests.authenticate_as(:'a');
select lives_ok(format($$ delete from listings where id = %L $$, :'lr'), '17a. a provider can delete their never-published draft');
select tests.clear_authentication();
select is((select count(*)::int from notifications where listing_id = :'lr'), 0, '17b. its notifications are deleted with it');

-- 18. Realtime publishes the table.
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'),
  '18. notifications are published to Realtime');

select * from finish();
rollback;
