-- Listing review emails (migration listing_review_emails): approving,
-- rejecting, taking down and restoring a listing each queue one email to the
-- provider, in the same transaction; a rejection or takedown carries exactly
-- the reason the provider sees in their editor, an approval or restore no
-- text; nothing is queued when the review is refused; and the outbox stays
-- the server's (providers can't read it).
begin;
\ir _helpers/users.psql
select plan(22);

select tests.create_user('lre-owner@test.local') as owner \gset
select tests.create_user('lre-support@test.local') as sup \gset
select tests.create_user('lre-provider@test.local') as powner \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'LRE Ward') returning id as area \gset
insert into categories (kind, name, slug) values ('experience', 'LRE food', 'lre-food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'LRE cuts', 'lre-cuts') returning id as svc \gset
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'powner', 'LRE Tours', :'atl', 'acct_test_lre', true, true) returning id as p \gset

-- Two Experiences waiting for review, ready to go live; a live Service.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'LRE crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'area')
returning id as le1 \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'LRE walk', 'Murals of Cabbagetown, with the people who painted them.', 4000, 90, :'area')
returning id as le2 \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id, booking_mode, duration_minutes)
values (:'p', 'service', :'svc', :'atl', 'LRE studio cut', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'area', 'instant', 60)
returning id as ls \gset
select tests.make_ready(:'le1');
select tests.make_ready(:'le2');
select tests.make_ready(:'ls');
update listings set status = 'submitted' where id in (:'le1', :'le2');
update listings set status = 'live', published_at = now() where id = :'ls';

-- This test's emails, newest last: kind and message.
create function pg_temp.emails() returns text language sql as $$
  select coalesce(string_agg(e.kind || ':' || coalesce(e.message, '-'), ',' order by e.created_at, e.kind), '')
  from public.provider_emails e where e.provider_id = (select id from public.providers where display_name = 'LRE Tours')
$$;

-- Support, through the server on their own session.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- 1. REFUSED REVIEWS QUEUE NOTHING
-- ---------------------------------------------------------------------------

select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'submitted', 'rejected', 'Too short') $$, :'sup', :'le1'), '23514',
  'Give a reason of at least 10 characters. The provider sees it.', '1a. a rejection without a proper reason is refused');
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Photos show another business.') $$, :'sup', :'le1'), '55000',
  NULL, '1b. a listing that''s moved on since the page loaded is refused');
select tests.clear_authentication();
select is(pg_temp.emails(), '', '1c. ...and neither queued an email');

-- ---------------------------------------------------------------------------
-- 2. EACH REVIEW: ONE EMAIL, WITH THE PROVIDER-FACING REASON ONLY
-- ---------------------------------------------------------------------------

select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'submitted', 'live') $$, :'sup', :'le1'), '2a. support approves an Experience');
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'submitted', 'rejected', '  The photos are of another tour.  ') $$, :'sup', :'le2'),
  '2b. ...rejects another, with a reason');
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Its address is a private home.') $$, :'sup', :'ls'),
  '2c. ...takes a live Service down');
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'unpublished', 'live') $$, :'sup', :'ls'), '2d. ...and restores it');
select tests.clear_authentication();

select is(pg_temp.emails(),
  'provider_listing_approved:-,provider_listing_rejected:The photos are of another tour.,provider_listing_unpublished:Its address is a private home.,provider_listing_restored:-',
  '2e. four emails, in order: approval and restore with no text, rejection and takedown with the reason, trimmed');
select is((select count(*)::int from provider_emails e join admin_actions a on a.id = e.admin_action_id
            where e.provider_id = :'p' and a.target = 'listing' and a.action in ('approve_listing', 'reject_listing', 'unpublish_listing', 'restore_listing')
              and a.target_id in (:'le1', :'le2', :'ls')), 4,
  '2f. each tied to its review action, which names the listing');
select is((select e.message from provider_emails e join admin_actions a on a.id = e.admin_action_id where a.action = 'reject_listing' and a.target_id = :'le2'),
  (select rejection_reason from listings where id = :'le2'), '2g. the rejection''s text is exactly what the provider''s editor shows');
select is((select e.message from provider_emails e join admin_actions a on a.id = e.admin_action_id where a.action = 'unpublish_listing' and a.target_id = :'ls'),
  (select a.reason from admin_actions a where a.action = 'unpublish_listing' and a.target_id = :'ls'),
  '2h. ...and the takedown''s is the reason logged, nothing more');
select is((select count(*)::int from provider_emails where provider_id = :'p' and status = 'pending' and to_address is null), 4,
  '2i. all waiting for the sender, which looks up the address when it sends');

-- The owner's own review emails the provider the same way.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Owner checking the takedown email.') $$, :'owner', :'ls'),
  '2j. the owner takes it down');
select tests.clear_authentication();
select is((select count(*)::int from provider_emails e join admin_actions a on a.id = e.admin_action_id
            where a.admin_id = :'owner' and e.kind = 'provider_listing_unpublished' and e.message = 'Owner checking the takedown email.'), 1,
  '2k. ...and the provider is emailed, with the reason');

-- ---------------------------------------------------------------------------
-- 3. THE RULE ON TEXT, ENFORCED BY THE TABLE ITSELF
-- ---------------------------------------------------------------------------

select a.id as act_reject from admin_actions a where a.action = 'reject_listing' and a.target_id = :'le2' \gset
insert into admin_actions (admin_id, target, target_id, action, reason)
values (:'sup', 'listing', :'le1', 'unpublish_listing', 'A spare action for the constraint checks.') returning id as spare \gset
select throws_ok(format($$ insert into provider_emails (provider_id, admin_action_id, kind) values (%L, %L, 'provider_listing_rejected') $$, :'p', :'spare'),
  '23514', NULL, '3a. a rejection email without its reason: refused');
select throws_ok(format($$ insert into provider_emails (provider_id, admin_action_id, kind) values (%L, %L, 'provider_listing_unpublished') $$, :'p', :'spare'),
  '23514', NULL, '3b. ...a takedown email without its reason too');
select throws_ok(format($$ insert into provider_emails (provider_id, admin_action_id, kind, message) values (%L, %L, 'provider_listing_approved', 'Internal note') $$, :'p', :'spare'),
  '23514', NULL, '3c. an approval email can''t carry text');
select throws_ok(format($$ insert into provider_emails (provider_id, admin_action_id, kind, message) values (%L, %L, 'provider_listing_restored', 'Internal note') $$, :'p', :'spare'),
  '23514', NULL, '3d. ...nor a restore email');
select throws_ok(format($$ update provider_emails set message = 'Changed later.' where admin_action_id = %L $$, :'act_reject'),
  '23514', NULL, '3e. a queued email''s reason can''t be changed afterwards (outbox_guard)');

-- ---------------------------------------------------------------------------
-- 4. WHO CAN READ THE OUTBOX
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'powner');
select is((select count(*)::int from provider_emails), 0, '4a. the provider can''t read the outbox (they get the email)');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is((select count(*)::int from provider_emails where provider_id = :'p'), 5, '4b. the team can, to see what was sent');
select tests.authenticate_as(:'powner');
select throws_ok(format($$ insert into provider_emails (provider_id, admin_action_id, kind, message) values (%L, %L, 'provider_listing_rejected', 'Fake reason here.') $$, :'p', :'spare'),
  '42501', NULL, '4c. nobody but the server writes it');
select tests.clear_authentication();

select * from finish();
rollback;
