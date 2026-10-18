-- Money actions whose reply was lost (migration money_lost_replies): an
-- accept judged at the time Stripe captured the card, a cancellation's
-- policy judged at the time Stripe refunded, and the admin money actions
-- writing the booking change and the admin log together.
begin;
\ir _helpers/users.psql
\ir _helpers/slots.psql
select plan(42);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('admin@test.local') as admin \gset
-- Admins are team members now (admin_members; docs/design/admin-roles.md).
select tests.make_admin(:'admin');
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'o4w', 'submitted')
returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id, booking_mode)
values (:'p', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 60, 'provider_location', :'o4w', 'approve')
returning id as ls \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'le', :'ls');
update listings set status = 'live', published_at = now() where id in (:'le', :'ls');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 20) returning id as s1 \gset
select (now() + interval '3 days')::timestamptz as t1 \gset

-- Test-only: sets a booking's times with the guard off (a transaction's
-- now() never moves, so the past is made by moving the booking back).
create function pg_temp.set_times(p_id uuid, p_created timestamptz, p_confirmed timestamptz, p_starts timestamptz, p_respond_by timestamptz)
returns void language plpgsql as $$
begin
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set created_at = coalesce(p_created, created_at), confirmed_at = coalesce(p_confirmed, confirmed_at),
    starts_at = coalesce(p_starts, starts_at), ends_at = coalesce(p_starts + interval '1 hour', ends_at),
    payout_due_at = coalesce(p_starts + interval '25 hours', payout_due_at), respond_by = coalesce(p_respond_by, respond_by)
   where id = p_id;
  alter table public.bookings enable trigger bookings_guard;
end;
$$;
create function pg_temp.logs(p_id uuid) returns int language sql as $$
  select count(*)::int from public.admin_actions where target = 'booking' and target_id = p_id
$$;
grant execute on function pg_temp.logs(uuid) to service_role;

select tests.authenticate_as_server_for(:'admin');
-- Three requests, made two days ago, whose answer-by time passed an hour ago.
create temp table req (label text primary key, id uuid);
-- One statement each: each takes the next free slot (the one before holds its own).
select tests.make_bookable(:'p');
insert into req select 'late', (create_service_booking(:'ls', :'cust', tests.slot(:'ls'), 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id;
insert into req select 'early', (create_service_booking(:'ls', :'cust', tests.slot(:'ls'), 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id;
insert into req select 'future', (create_service_booking(:'ls', :'cust', tests.slot(:'ls'), 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id;
insert into req select 'plain', (create_service_booking(:'ls', :'cust', tests.slot(:'ls'), 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id;
update bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id in (select id from req);
select id as r_late from req where label = 'late' \gset
select id as r_early from req where label = 'early' \gset
select id as r_future from req where label = 'future' \gset
select id as r_plain from req where label = 'plain' \gset
-- Eight paid Experience bookings, confirmed three days ago.
create temp table bk (label text primary key, id uuid);
insert into bk select l, (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id
  from unnest(array['started', 'late48', 'nopolicy', 'admin', 'unlogged', 'changed', 'short', 'resolved']) l;
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id in (select id from bk);
select id as b_started from bk where label = 'started' \gset
select id as b_late48 from bk where label = 'late48' \gset
select id as b_nopolicy from bk where label = 'nopolicy' \gset
select id as b_admin from bk where label = 'admin' \gset
select id as b_unlogged from bk where label = 'unlogged' \gset
select id as b_changed from bk where label = 'changed' \gset
select id as b_short from bk where label = 'short' \gset
select id as b_resolved from bk where label = 'resolved' \gset
select tests.clear_authentication();
select pg_temp.set_times(id, now() - interval '2 days', null, null, now() - interval '1 hour') from req where label <> 'plain';
select pg_temp.set_times(id, now() - interval '4 days', now() - interval '3 days', null, null) from bk;
-- Started an hour ago; starts in 30 hours (inside the 48-hour line).
select pg_temp.set_times(:'b_started', null, null, now() - interval '1 hour', null);
select pg_temp.set_times(:'b_late48', null, null, now() + interval '30 hours', null);
select pg_temp.set_times(:'b_nopolicy', null, null, now() + interval '30 hours', null);
select pg_temp.set_times(:'b_resolved', null, null, now() - interval '2 hours', null);
select tests.authenticate_as_server_for(:'admin');

-- ---------------------------------------------------------------------------
-- 1. ACCEPTING, judged at the time Stripe captured the card
-- ---------------------------------------------------------------------------

select throws_ok(format($$ update private.booking_records set status = 'confirmed', status_changed_by = 'provider' where id = %L $$, :'r_late'),
  '23514', 'The time to answer this request has passed.', '1a. accepting after the answer-by time is refused');
select lives_ok(format($$ update private.booking_records set status = 'confirmed', status_changed_by = 'provider', confirmed_at = now() - interval '2 hours' where id = %L $$, :'r_early'),
  '1b. captured before the answer-by time and recorded after it: confirmed');
select is((select confirmed_at from bookings where id = :'r_early'), now() - interval '2 hours', '1c. ...confirmed at the time of the capture');
select throws_ok(format($$ update private.booking_records set status = 'confirmed', status_changed_by = 'provider', confirmed_at = now() - interval '30 minutes' where id = %L $$, :'r_late'),
  '23514', 'The time to answer this request has passed.', '1d. captured after the answer-by time: refused');
select throws_ok(format($$ update private.booking_records set status = 'confirmed', status_changed_by = 'provider', confirmed_at = now() + interval '1 minute' where id = %L $$, :'r_future'),
  '23514', 'A request is accepted between when it was made and now.', '1e. an accept time in the future is refused');
select throws_ok(format($$ update private.booking_records set status = 'confirmed', status_changed_by = 'provider', confirmed_at = now() - interval '3 days' where id = %L $$, :'r_future'),
  '23514', 'A request is accepted between when it was made and now.', '1f. an accept time before the request is refused');
update private.booking_records set status = 'confirmed', status_changed_by = 'provider' where id = :'r_plain';
select is((select confirmed_at from bookings where id = :'r_plain'), now(), '1g. an accept with no time is confirmed now, as before');
select throws_ok(format($$ update private.booking_records set confirmed_at = now() - interval '1 hour' where id = %L $$, :'r_plain'),
  '23514', 'A booking''s time and payout date only change with its status.', '1h. the accept time can''t be changed afterwards');

-- ---------------------------------------------------------------------------
-- 2. CANCELLING, judged at the time Stripe refunded
-- ---------------------------------------------------------------------------

select throws_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'provider', cancel_reason = 'The venue closed.', refunded_cents = 6500, status_changed_by = 'provider' where id = %L $$, :'b_started'),
  '23514', 'This booking has started, so it can''t be cancelled.', '2a. a provider cancel recorded after the start is refused');
select lives_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'provider', cancel_reason = 'The venue closed.', refunded_cents = 6500, status_changed_by = 'provider', cancelled_at = now() - interval '2 hours' where id = %L $$, :'b_started'),
  '2b. refunded before the start, recorded after it: cancelled');
select is((select cancelled_at from bookings where id = :'b_started'), now() - interval '2 hours', '2c. ...cancelled at the time of the refund');
select throws_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'customer', status_changed_by = 'customer', cancelled_at = now() - interval '2 days' where id = %L $$, :'b_late48'),
  '23514', 'This cancellation gets a full refund. Refund it before cancelling.', '2d. a customer''s cancel from before the 48-hour line must be refunded in full');
select lives_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'customer', status_changed_by = 'customer', refunded_cents = 6500, cancelled_at = now() - interval '2 days' where id = %L $$, :'b_late48'),
  '2e. ...and refunded in full, it''s recorded after the line');
select lives_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'customer', status_changed_by = 'customer' where id = %L $$, :'b_nopolicy'),
  '2f. a customer''s cancel now, inside 48 hours, needs no refund, as before');
select is((select cancelled_at from bookings where id = :'b_nopolicy'), now(), '2g. ...cancelled now');
select throws_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'admin', refunded_cents = 6500, status_changed_by = 'admin', cancelled_at = now() - interval '5 days' where id = %L $$, :'b_short'),
  '23514', 'A booking is cancelled between when it was booked and now.', '2h. a cancel time before the booking is refused');

-- ---------------------------------------------------------------------------
-- 3. ADMIN MONEY ACTIONS: the change and the log together
-- ---------------------------------------------------------------------------

select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'The venue closed.', 'confirmed', false, 6500, null, null, null) $$, :'b_admin', :'cust'),
  '42501', 'Only an admin can cancel a booking this way.', '3a. only an admin''s id is accepted');
select is(admin_cancel_booking(:'b_admin', :'admin', 'The venue closed.', 'confirmed', false, 6500, null, null, null), 'cancelled', '3b. lokl cancels and refunds');
select is((select array[status, cancelled_by, refunded_cents::text] from private.booking_records where id = :'b_admin'),
  array['cancelled', 'admin', '6500'], '3c. ...cancelled by lokl and refunded in full');
select is(pg_temp.logs(:'b_admin'), 1, '3d. ...and logged');
select is(admin_cancel_booking(:'b_admin', :'admin', 'The venue closed.', 'confirmed', false, 6500, null, null, null), 'already cancelled', '3e. a retry answers that it''s done');
select is(pg_temp.logs(:'b_admin'), 1, '3f. ...logged once');
-- Cancelled by lokl before this migration, with the log lost.
update private.booking_records set status = 'cancelled', cancelled_by = 'admin', refunded_cents = 6500, status_changed_by = 'admin' where id = :'b_unlogged';
select is(admin_cancel_booking(:'b_unlogged', :'admin', 'The venue closed.', 'confirmed', false, 6500, null, null, null), 'logged', '3g. cancelled with no log: a retry writes the log');
select is(pg_temp.logs(:'b_unlogged'), 1, '3h. ...once');
-- A retry counts as done only if it's the same action.
select is(admin_cancel_booking(:'b_admin', :'admin', 'The venue closed.', 'confirmed', true, 6500, null, null, null), 'changed',
  '3h2. resolving a report with a refund on a booking lokl cancelled plainly: changed, not done');
select is(pg_temp.logs(:'b_admin'), 1, '3h3. ...and not logged again');
update private.booking_records set problem_reported_at = now(), problem_note = 'Nobody was there at all.', payout_hold = 'problem_reported', payout_held_at = now() where id = :'b_resolved';
select is(admin_cancel_booking(:'b_resolved', :'admin', 'Nobody turned up.', 'confirmed', true, 6500, null, null, null), 'cancelled', '3h4. lokl resolves a report with a refund');
select is(admin_cancel_booking(:'b_resolved', :'admin', 'Nobody turned up.', 'confirmed', true, 6500, null, null, null), 'already cancelled', '3h5. a retry of the same resolution is done');
select is(admin_cancel_booking(:'b_resolved', :'admin', 'Nobody turned up.', 'confirmed', false, 6500, null, null, null), 'changed', '3h6. a plain cancel of a booking resolved with a refund: changed, not done');
select is(pg_temp.logs(:'b_resolved'), 1, '3h7. ...logged once');
select is(admin_cancel_booking(:'b_changed', :'admin', 'The venue closed.', 'completed', false, 6500, null, null, null), 'changed', '3i. a booking that moved on isn''t changed');
select is(pg_temp.logs(:'b_changed'), 0, '3j. ...or logged');
select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'No.', 'confirmed', false, 6500, null, null, null) $$, :'b_short', :'admin'),
  '23514', null, '3k. a log that can''t be written fails the whole action');
select is((select status from bookings where id = :'b_short'), 'confirmed', '3l. ...and the booking isn''t cancelled');

-- Release a payout hold, and resolve a report in the provider's favour.
update private.booking_records set payout_hold = 'refunded', payout_held_at = now() where id = :'b_changed';
select is(admin_release_payout(:'b_changed', :'admin', 'Checked with the customer.', 'refunded'), true, '3m. lokl releases a payout hold');
select is((select array[coalesce(payout_hold, '-'), array_to_string(payout_holds_released, ',')] from private.booking_records where id = :'b_changed'),
  array['-', 'refunded'], '3n. ...the hold is cleared and remembered');
select is(admin_release_payout(:'b_changed', :'admin', 'Checked with the customer.', 'refunded') or pg_temp.logs(:'b_changed') <> 1, false,
  '3o. a retry changes nothing, logged once');
select tests.clear_authentication();
select pg_temp.set_times(:'b_short', null, null, now() - interval '2 hours', null);
select tests.authenticate_as_server_for(:'admin');
update private.booking_records set problem_reported_at = now(), problem_note = 'Nobody was there at all.', payout_hold = 'problem_reported', payout_held_at = now() where id = :'b_short';
select throws_ok(format($$ select admin_resolve_problem_paid(%L, %L, 'No.') $$, :'b_short', :'admin'),
  '23514', null, '3p. resolving with a log that can''t be written changes nothing');
select is(admin_resolve_problem_paid(:'b_short', :'admin', 'The provider sent photos.'), true, '3q. lokl resolves a report for the provider');
select is((select array[problem_resolution, coalesce(payout_hold, '-')] from private.booking_records where id = :'b_short'),
  array['paid_provider', '-'], '3r. ...resolved, its hold cleared');
select is(pg_temp.logs(:'b_short'), 1, '3s. ...and logged once');

-- ---------------------------------------------------------------------------
-- 4. SERVER ONLY
-- ---------------------------------------------------------------------------

select is((select bool_or(has_function_privilege(r, f, 'EXECUTE'))
   from unnest(array['anon', 'authenticated']) r,
        unnest(array['public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text)',
                     'public.admin_release_payout(uuid, uuid, text, text)', 'public.admin_resolve_problem_paid(uuid, uuid, text)']) f),
  false, '4. visitors and signed-in users can''t call the admin money actions');

select * from finish();
rollback;
