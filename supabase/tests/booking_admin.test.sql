-- The admin side of bookings (step 4, part 8): resolving no-show reports,
-- cancelling after a payout, the admin action log, commission history and
-- job runs, and who can see them.
begin;
\ir _helpers/users.psql
select plan(26);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'o4w', 'submitted')
returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'le';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 20) returning id as s1 \gset

-- Test-only: moves a booking into the past with the guard off (so it has
-- happened and a problem can be reported). Gone when the test rolls back.
create function pg_temp.happened(p_id uuid) returns void language plpgsql as $$
begin
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
    payout_due_at = now() + interval '23 hours', confirmed_at = now() - interval '3 days' where id = p_id;
  alter table public.bookings enable trigger bookings_guard;
end;
$$;
create function pg_temp.kinds(p_id uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.booking_emails where booking_id = p_id
$$;
-- Called as the API roles: new functions get no PUBLIC EXECUTE (function_execute_grants).
grant execute on function pg_temp.kinds(uuid) to anon, authenticated, service_role;

select tests.authenticate_as_service_role();
create temp table bk (label text primary key, id uuid);
insert into bk select l, (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id
  from unnest(array['paid', 'refund', 'paidout', 'owed', 'plain']) l;
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id in (select id from bk);
select id as b_paid from bk where label = 'paid' \gset
select id as b_refund from bk where label = 'refund' \gset
select id as b_paidout from bk where label = 'paidout' \gset
select id as b_owed from bk where label = 'owed' \gset
select id as b_plain from bk where label = 'plain' \gset
select tests.clear_authentication();
select pg_temp.happened(id) from bk;
select tests.authenticate_as_service_role();
update bookings set status = 'completed', status_changed_by = 'system' where id in (select id from bk);
update private.booking_records set problem_reported_at = now(), problem_note = 'Nobody was there at all.', payout_hold = 'problem_reported', payout_held_at = now()
 where id in (:'b_paid', :'b_refund');

-- ---------------------------------------------------------------------------
-- RESOLVING A NO-SHOW REPORT
-- ---------------------------------------------------------------------------

-- 1. Only a reported problem can be resolved; a refund cancels and refunds in full.
select throws_ok(format($$ update bookings set problem_resolution = 'paid_provider', problem_resolved_at = now() where id = %L $$, :'b_plain'),
  '23514', 'Only a reported problem can be resolved.', '1a. a booking with no report can''t be "resolved"');
select throws_ok(format($$ update bookings set problem_resolution = 'refunded', problem_resolved_at = now() where id = %L $$, :'b_refund'),
  '23514', 'Resolving a report with a refund cancels the booking and refunds it in full.', '1b. a refund resolution needs the booking cancelled and refunded');
select throws_ok(format($$ update bookings set problem_resolution = 'paid_provider' where id = %L $$, :'b_paid'),
  '23514', NULL, '1c. a resolution needs its time');

-- 2. In the provider's favour: the payout can go ahead, and they're told.
select throws_ok(format($$ update private.booking_records set status = 'paid_out', stripe_transfer_id = 'tr_test_a', payout_hold = null, payout_held_at = null, status_changed_by = 'system' where id = %L $$, :'b_paid'),
  '23514', 'A reported problem holds the payout.', '2a. an unresolved report still holds the payout');
update private.booking_records set problem_resolution = 'paid_provider', problem_resolved_at = now(), payout_hold = null, payout_held_at = null where id = :'b_paid';
select ok(pg_temp.kinds(:'b_paid') @> array['provider_problem_paid'], '2b. resolving in the provider''s favour emails the provider');
select lives_ok(format($$ update private.booking_records set status = 'paid_out', stripe_transfer_id = 'tr_test_a', status_changed_by = 'system' where id = %L $$, :'b_paid'),
  '2c. ...and the payout can then go ahead');
select throws_ok(format($$ update bookings set problem_resolution = 'refunded', problem_resolved_at = now() where id = %L $$, :'b_paid'),
  '23514', 'This report has already been resolved.', '2d. a report is resolved once');

-- 3. With a refund: cancelled, refunded, and the report's emails instead of the cancellation ones.
select lives_ok(format($$ update bookings set status = 'cancelled', cancelled_by = 'admin', cancel_reason = 'The provider didn''t show up.', refunded_cents = total_cents,
  status_changed_by = 'admin', problem_resolution = 'refunded', problem_resolved_at = now() where id = %L $$, :'b_refund'),
  '3a. resolving with a refund cancels the booking, refunded in full');
select ok(pg_temp.kinds(:'b_refund') @> array['customer_problem_refunded', 'provider_problem_refunded'], '3b. the customer and provider hear the report''s outcome');
select ok(not pg_temp.kinds(:'b_refund') @> array['customer_booking_cancelled'] and not pg_temp.kinds(:'b_refund') @> array['provider_booking_cancelled'],
  '3c. ...instead of the usual cancellation emails');

-- ---------------------------------------------------------------------------
-- CANCELLING AFTER THE PAYOUT
-- ---------------------------------------------------------------------------

update private.booking_records set status = 'paid_out', stripe_transfer_id = 'tr_test_b', status_changed_by = 'system' where id = :'b_paidout';
update private.booking_records set status = 'paid_out', stripe_transfer_id = 'tr_test_c', status_changed_by = 'system' where id = :'b_owed';

-- 4. Only lokl, refunded in full, with the transfer reversed or its failure recorded.
select throws_ok(format($$ update bookings set status = 'cancelled', cancelled_by = 'customer', refunded_cents = total_cents, status_changed_by = 'customer' where id = %L $$, :'b_paidout'),
  '23514', 'Only lokl can cancel a booking that has been paid out.', '4a. a customer can''t cancel a paid-out booking');
select throws_ok(format($$ update bookings set status = 'cancelled', cancelled_by = 'admin', refunded_cents = total_cents, status_changed_by = 'admin' where id = %L $$, :'b_paidout'),
  '23514', 'Reverse the provider''s transfer (or record why it failed) before cancelling a paid-out booking.', '4b. lokl must reverse the transfer first');
select throws_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'admin', stripe_transfer_reversal_id = 'trr_test', status_changed_by = 'admin' where id = %L $$, :'b_paidout'),
  '23514', 'This cancellation gets a full refund. Refund it before cancelling.', '4c. ...and refund the customer in full');
select lives_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'admin', stripe_transfer_reversal_id = 'trr_test', refunded_cents = total_cents, status_changed_by = 'admin' where id = %L $$, :'b_paidout'),
  '4d. with the reversal and the refund, lokl cancels a paid-out booking');
select ok(pg_temp.kinds(:'b_paidout') @> array['customer_booking_cancelled', 'provider_booking_cancelled'], '4e. both are told lokl cancelled it');
select lives_ok(format($$ update private.booking_records set status = 'cancelled', cancelled_by = 'admin', reversal_failed_at = now(), reversal_failure = 'Insufficient funds', refunded_cents = total_cents, status_changed_by = 'admin' where id = %L $$, :'b_owed'),
  '4f. a reversal that failed is recorded as owed, and the cancellation goes ahead');

-- ---------------------------------------------------------------------------
-- ADMIN ACTIONS, COMMISSION HISTORY, JOB RUNS
-- ---------------------------------------------------------------------------

-- 5. The action log needs a reason (except for sending an email again).
select throws_ok(format($$ insert into admin_actions (admin_id, target, target_id, action, reason) values (%L, 'booking', %L, 'cancel_booking', 'no') $$, :'admin', :'b_plain'),
  '23514', NULL, '5a. an admin action needs a reason of a few words');
select lives_ok(format($$ insert into admin_actions (admin_id, target, target_id, action, reason) values (%L, 'booking', %L, 'cancel_booking', 'The venue closed.') $$, :'admin', :'b_plain'),
  '5b. with a reason, it''s logged');
select lives_ok(format($$ insert into admin_actions (admin_id, target, target_id, action) values (%L, 'email', gen_random_uuid(), 'retry_email') $$, :'admin'),
  '5c. sending an email again needs no reason');
insert into job_runs (job, started_at, checked, changed, failed, failures) values ('pay-out', now(), 3, 1, 1, array['x: failed']);

-- 6. A commission change is recorded with who made it.
select tests.authenticate_as_admin(:'admin');
update commission_rates set rate_bps = 1300 where kind = 'service';
select is((select array[old_rate_bps, new_rate_bps] from commission_rate_changes where kind = 'service'), array[1200, 1300], '6a. a rate change records the old and new rate');
select is((select changed_by from commission_rate_changes where kind = 'service'), :'admin'::uuid, '6b. ...and which admin made it');

-- 7. Admins read the log, the history and the job runs; nobody else does, and nobody writes them.
select ok((select count(*) from admin_actions) >= 2 and (select count(*) from job_runs) = 1 and (select count(*) from commission_rate_changes) = 1,
  '7a. the admin reads the action log, the rate history and the job runs');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from admin_actions) + (select count(*)::int from commission_rate_changes) + (select count(*)::int from job_runs), 0,
  '7b. a provider reads none of them');
select tests.authenticate_as(:'cust');
select is((select count(*)::int from admin_actions) + (select count(*)::int from job_runs), 0, '7c. nor does a customer');
select throws_ok(format($$ insert into admin_actions (admin_id, target, target_id, action, reason) values (%L, 'booking', %L, 'cancel_booking', 'Pretending to be lokl.') $$, :'cust', :'b_plain'),
  '42501', NULL, '7d. a signed-in user can''t write to the action log');
select tests.authenticate_as_admin(:'admin');
select throws_ok($$ insert into job_runs (job, started_at) values ('pay-out', now()) $$, '42501', NULL, '7e. even an admin can''t write job runs (only the server does)');

select * from finish();
rollback;
