-- Booking emails (step 4, part 7): which changes queue which emails, once
-- each, and who can see them (admins read; nobody else reads or writes).
begin;
\ir _helpers/users.psql
select plan(25);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner', 'Tours and Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 150, :'o4w', 'submitted')
returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id)
values (:'p', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 60, 'provider_location', :'o4w')
returning id as ls \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A photo' from listings where id in (:'le', :'ls');
update listings set status = 'live', published_at = now() where id in (:'le', :'ls');
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 20) returning id as s1 \gset
select (now() + interval '3 days')::timestamptz as t1 \gset

-- Test-only: moves a booking's start (and when it was confirmed) with the
-- guard off. Temporary; gone when the test rolls back.
create function pg_temp.shift(p_id uuid, p_starts_in interval) returns void
language plpgsql as $$
begin
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set starts_at = now() + p_starts_in, ends_at = now() + p_starts_in + interval '1 hour',
    payout_due_at = now() + p_starts_in + interval '25 hours', confirmed_at = now() - interval '3 days'
   where id = p_id;
  alter table public.bookings enable trigger bookings_guard;
end;
$$;

select tests.authenticate_as_service_role();
create temp table k (id uuid);
-- The kinds queued for a booking, sorted.
create function pg_temp.kinds(p_id uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.booking_emails where booking_id = p_id
$$;
-- A paid Service request, and a reserved Experience.
create function pg_temp.request(p_listing uuid, p_customer uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_service_request(p_listing, p_customer, array[now() + interval '3 days'],
        'Sam Customer', 'sam@test.local', null, null, null, now() + interval '30 minutes')).id;
  update public.bookings set status = 'requested', status_changed_by = 'stripe', respond_by = now() + interval '48 hours' where id = v;
  return v;
end;
$$;
create function pg_temp.reserve(p_session uuid, p_customer uuid) returns uuid language sql as $$
  select (public.reserve_experience_booking(p_session, p_customer, 1::smallint, 'Sam Customer', 'sam@test.local',
    null, null, now() + interval '30 minutes')).id
$$;

-- ---------------------------------------------------------------------------
-- WHICH CHANGE QUEUES WHICH EMAILS
-- ---------------------------------------------------------------------------

-- 1. Requests.
select pg_temp.request(:'ls', :'cust') as r1 \gset
select is(pg_temp.kinds(:'r1'), array['customer_request_sent', 'provider_new_request'], '1a. a paid request queues "request sent" and "new request"');
update bookings set status = 'confirmed', starts_at = preferred_times[1], status_changed_by = 'provider' where id = :'r1';
select is(pg_temp.kinds(:'r1'), array['customer_request_accepted', 'customer_request_sent', 'provider_new_request'], '1b. accepting adds "accepted"');
select pg_temp.request(:'ls', :'cust') as r2 \gset
update bookings set status = 'declined', status_changed_by = 'provider' where id = :'r2';
select is(pg_temp.kinds(:'r2'), array['customer_request_declined', 'customer_request_sent', 'provider_new_request'], '1c. declining adds "declined" for the customer only');
select pg_temp.request(:'ls', :'cust') as r3 \gset
update bookings set status = 'expired', status_changed_by = 'system' where id = :'r3';
select ok(pg_temp.kinds(:'r3') @> array['customer_request_expired', 'provider_request_unanswered'], '1d. no answer in time: the customer and the provider both hear');
select pg_temp.request(:'ls', :'cust') as r4 \gset
update bookings set status = 'expired', status_changed_by = 'provider' where id = :'r4';
select ok(pg_temp.kinds(:'r4') @> array['customer_request_expired'] and not pg_temp.kinds(:'r4') @> array['provider_request_unanswered'],
  '1e. the card failing on accept: only the customer hears');

-- 2. Experiences: paid, or a checkout abandoned (no email).
select pg_temp.reserve(:'s1', :'cust') as e1 \gset
select is(pg_temp.kinds(:'e1'), '{}'::text[], '2a. a reservation in checkout queues nothing');
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'e1';
select is(pg_temp.kinds(:'e1'), array['customer_booking_confirmed', 'provider_new_booking'], '2b. a paid Experience queues "you''re booked" and "new booking"');
select pg_temp.reserve(:'s1', :'cust') as e2 \gset
update bookings set status = 'expired', status_changed_by = 'system' where id = :'e2';
select is(pg_temp.kinds(:'e2'), '{}'::text[], '2c. an abandoned checkout queues nothing');

-- 3. Cancellations: the provider isn't emailed about their own.
update bookings set status = 'cancelled', cancelled_by = 'customer', refunded_cents = total_cents, status_changed_by = 'customer' where id = :'e1';
select ok(pg_temp.kinds(:'e1') @> array['customer_booking_cancelled', 'provider_booking_cancelled'], '3a. a customer''s cancellation emails both');
select pg_temp.reserve(:'s1', :'cust') as e3 \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'e3';
update bookings set status = 'cancelled', cancelled_by = 'provider', cancel_reason = 'I''m unwell that day.', refunded_cents = total_cents, status_changed_by = 'provider' where id = :'e3';
select ok(pg_temp.kinds(:'e3') @> array['customer_booking_cancelled'] and not pg_temp.kinds(:'e3') @> array['provider_booking_cancelled'],
  '3b. a provider''s own cancellation emails only the customer');
select pg_temp.request(:'ls', :'cust') as r5 \gset
update bookings set status = 'cancelled', cancelled_by = 'customer', status_changed_by = 'customer' where id = :'r5';
select ok(pg_temp.kinds(:'r5') @> array['customer_booking_cancelled', 'provider_booking_cancelled'], '3c. a withdrawn request emails both');

-- 4. After the booking: a no-show report, a payout, a payout the account can't take.
select pg_temp.reserve(:'s1', :'cust') as e4 \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'e4';
select tests.clear_authentication();
select pg_temp.shift(:'e4', interval '-2 hours');
select tests.authenticate_as_service_role();
update private.booking_records set problem_reported_at = now(), problem_note = 'Nobody was there at all.', payout_hold = 'problem_reported', payout_held_at = now() where id = :'e4';
select ok(pg_temp.kinds(:'e4') @> array['customer_problem_received', 'provider_problem_reported'], '4a. a no-show report emails the customer (received) and the provider (reported)');
select ok(not pg_temp.kinds(:'e4') @> array['provider_payout_problem'], '4b. a hold for a report isn''t a "payout problem" email');
select pg_temp.reserve(:'s1', :'cust') as e5 \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'e5';
update bookings set status = 'completed', status_changed_by = 'system' where id = :'e5';
update private.booking_records set payout_hold = 'account_cannot_receive', payout_held_at = now() where id = :'e5';
select ok(pg_temp.kinds(:'e5') @> array['provider_payout_problem'], '4c. a payout the provider''s account can''t take emails the provider');
update private.booking_records set payout_hold = null, payout_held_at = null where id = :'e5';
update private.booking_records set status = 'paid_out', stripe_transfer_id = 'tr_test_emails', status_changed_by = 'system' where id = :'e5';
select ok(pg_temp.kinds(:'e5') @> array['provider_payout_sent'], '4d. a payout emails the provider');
select pg_temp.reserve(:'s1', :'cust') as e6 \gset
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'e6';
update bookings set status = 'completed', status_changed_by = 'system' where id = :'e6';
update private.booking_records set payout_hold = 'dispute', payout_held_at = now() where id = :'e6';
select ok(not pg_temp.kinds(:'e6') @> array['provider_payout_problem'], '4e. holds lokl handles alone (a dispute) email nobody');

-- 5. Once each: repeating a change, or queueing again, adds nothing.
select count(*)::int as before from booking_emails \gset
update bookings set status = 'confirmed' where id = :'r1';
select booking_emails_queue(:'r1', array['customer_request_accepted', 'customer_request_sent']);
select is((select count(*)::int from booking_emails), :before, '5a. a repeated change or a repeated queue adds no email');
select is((select recipient from booking_emails where booking_id = :'r1' and kind = 'provider_new_request'), 'provider',
  '5b. the recipient follows from the kind');
select is((select status from booking_emails where booking_id = :'r1' and kind = 'customer_request_sent'), 'pending', '5c. emails start pending');

-- ---------------------------------------------------------------------------
-- WHO CAN SEE THEM
-- ---------------------------------------------------------------------------

-- 6. Admins read; the provider, the customer and visitors don't; nobody writes.
select tests.authenticate_as_admin(:'admin');
select ok((select count(*)::int from booking_emails) > 0, '6a. the admin reads booking emails');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from booking_emails), 0, '6b. the provider reads none');
select tests.authenticate_as(:'cust');
select is((select count(*)::int from booking_emails), 0, '6c. the customer reads none');
select throws_ok(format($$ insert into booking_emails (booking_id, kind) values (%L, 'customer_request_sent') $$, :'r2'),
  '42501', NULL, '6d. a signed-in user can''t queue an email');
select throws_ok($$ select booking_emails_queue(gen_random_uuid(), array['customer_request_sent']) $$,
  '42501', NULL, '6e. ...or call the queue function');
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from booking_emails $$, '42501', NULL, '6f. a signed-out visitor can''t read them at all');

select * from finish();
rollback;
