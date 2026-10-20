-- Admin roles, step 5c (migration admin_contact_views; docs/design/admin-roles.md):
-- contact details only through a recorded view, support's daily limits for
-- contact views, refunds and requests (per Atlanta day), and the owners'
-- alerts for each refund by support and for a limit reached.
begin;
\ir _helpers/users.psql
select plan(72);

select tests.create_user('cv-owner@test.local') as owner \gset
select tests.create_user('cv-owner2@test.local') as owner2 \gset
select tests.create_user('cv-support@test.local') as sup \gset
select tests.create_user('cv-support2@test.local') as sup2 \gset
select tests.create_user('cv-provider@test.local') as powner \gset
select tests.create_user('cv-customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select tests.make_admin(:'sup2', 'support') as sup2_session \gset
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup', :'sup2');
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'cust', 'aal2', now(), now()) returning id as cust_session \gset

insert into providers (owner_id, display_name, city_id) values (:'powner', 'CV Tours', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'CV food', 'cv-food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'CV Ward') returning id as area \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'CV crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'area', 'submitted')
returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'le';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 60) returning id as s1 \gset

-- Paid bookings: $130 each (2 people), one $65 (1 person).
select tests.authenticate_as_service_role();
create temp table bk (label text primary key, id uuid);
grant all on bk to service_role;
insert into bk select l, (reserve_experience_booking(:'s1', :'cust', n::smallint, 'Sam Customer', 'sam@test.local', '+14045550123', null, now() + interval '30 minutes')).id
  from (values ('a', 2), ('b', 2), ('c', 1), ('d', 2), ('e', 2), ('f', 2), ('g', 2), ('h', 2), ('i', 2), ('j', 1)) v(l, n);
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id in (select id from bk);
select tests.clear_authentication();
select id as ba from bk where label = 'a' \gset
select id as bb from bk where label = 'b' \gset
select id as bc from bk where label = 'c' \gset
select id as bd from bk where label = 'd' \gset
select id as be from bk where label = 'e' \gset
select id as bf from bk where label = 'f' \gset
select id as bg from bk where label = 'g' \gset
select id as bh from bk where label = 'h' \gset
select id as bi from bk where label = 'i' \gset
select id as bj from bk where label = 'j' \gset
insert into booking_addresses (booking_id, line1, city, state, postal_code) values (:'ba', '12 Elm Street', 'Atlanta', 'GA', '30312');
-- Small limits, to reach them here.
update admin_settings set support_contact_views_per_day = 2, support_refunds_per_day = 2, support_refund_cents_per_day = 20000, support_requests_per_day = 2;

-- ---------------------------------------------------------------------------
-- 1. Contact details only through a recorded view
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((select count(*)::int from booking_contacts) + (select count(*)::int from booking_addresses), 0, '1a. support reads neither contact table');
select is((select admin_bookings_page(p_q := 'Sam') -> 'rows' -> 0 ->> 'customer_email'), null, '1b. the bookings list sends no email');
select is(admin_booking_contact(:'ba') ->> 'email', 'sam@test.local', '1d. support sees a booking''s email through the recorded view');
select is(admin_booking_contact(:'ba') -> 'address' ->> 'line1', '12 Elm Street', '1e. ...and its Service address');
select tests.clear_authentication();
select is((select array_agg(distinct what order by what)::text from admin_contact_views where admin_id = :'sup' and booking_id = :'ba'),
  '{booking_address,booking_contact}', '1f. each view is recorded, contact and address');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((admin_my_limits() -> 'contact_views' ->> 'used')::int, 1, '1g. the same booking twice counts once');
select is(admin_provider_contact(:'p') ->> 'email', 'cv-provider@test.local', '1h. a provider owner''s email, the same way');
select is((admin_my_limits() -> 'contact_views' ->> 'used')::int, 2, '1i. ...counting toward the same limit');
select throws_ok(format($$ select admin_booking_contact(%L) $$, :'bb'), '42501', 'You''ve reached today''s limit for contact details (2). Ask the owner.',
  '1j. a third different one is refused');
select lives_ok(format($$ select admin_booking_contact(%L) $$, :'ba'), '1k. ...but one already seen today still opens');
select tests.clear_authentication();
select is((select count(*)::int from admin_actions where action = 'limit_reached' and target_id = :'sup' and message = 'contact_views'), 1,
  '1l. reaching the limit is logged once');
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where n.kind = 'limit_reached' and a.target_id = :'sup' and n.recipient_id in (:'owner', :'owner2')), 2, '1m. ...and every owner told');
select is((select count(*)::int from admin_emails e join admin_actions a on a.id = e.admin_action_id
            where e.kind = 'admin_limit_reached' and a.target_id = :'sup'), 2, '1n. ...by email too');

-- The owner: no limit, still recorded.
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select lives_ok(format($$ select admin_booking_contact(%L), admin_booking_contact(%L), admin_booking_contact(%L) $$, :'bb', :'bc', :'bd'), '1o. the owner has no limit');
select is((admin_my_limits() ->> 'limited')::boolean, false, '1p. ...and their limits say so');
select tests.clear_authentication();
select is((select count(distinct booking_id)::int from admin_contact_views where admin_id = :'owner'), 3, '1q. ...but each view is recorded');

-- Who else.
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select throws_ok(format($$ select admin_booking_contact(%L) $$, :'ba'), '42501', 'Admins only.', '1r. not a customer');
select tests.authenticate_as_anon();
select throws_ok(format($$ select admin_booking_contact(%L) $$, :'ba'), '42501', 'permission denied for function admin_booking_contact', '1s. not a visitor');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok($$ select to_address from booking_emails limit 1 $$, '42501', 'permission denied for table booking_emails', '1t. no outbox address through the API');
select lives_ok($$ select id, kind, status from booking_emails limit 1 $$, '1u. ...the rest of the outbox still reads');

-- The record: append-only; the owner reads all, each admin their own.
select tests.clear_authentication();
select throws_ok($$ update admin_contact_views set what = 'owner_email' $$, '23514', NULL, '1v. the record never changes (the runner included)');
select throws_ok($$ delete from admin_contact_views $$, '23514', NULL, '1w. ...and is never deleted');
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select is((select count(*)::int from admin_contact_views), 0, '1x. another support member sees none of it');
select throws_ok($$ select admin_contact_views_page() $$, '42501', 'Only the owner can see the record of contact views.', '1y. ...nor the Team page''s record');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
-- One row per detail seen: booking A twice (contact and address each time), the provider, A again.
select is((admin_contact_views_page(p_admin_id := :'sup') ->> 'total')::int, 7, '1z. the owner sees support''s views on the Team page');
select is(admin_contact_views_page(p_admin_id := :'sup') -> 'rows' -> 0 ->> 'admin_email', 'cv-support@test.local', '1z2. ...naming who');

-- ---------------------------------------------------------------------------
-- 2. Refunds: today's count and total, and the owners told of each
-- ---------------------------------------------------------------------------
-- support: two refunds allowed today, $200 in all.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_check_refund(:'sup', :'bd'), 13000, '2a. support''s first refund today: allowed ($130)');
select is(admin_cancel_booking(:'bd', :'sup', 'Customer was ill.', 'confirmed', false, 13000, now(), null, null), 'cancelled', '2b. ...recorded');
select tests.clear_authentication();
select is((select amount_cents from admin_actions where target_id = :'bd' and action = 'cancel_booking'), 13000, '2c. the amount it refunded is logged');
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where n.kind = 'support_refund' and a.target_id = :'bd' and n.recipient_id in (:'owner', :'owner2')), 2, '2d. every owner is told of it');
select is((select count(*)::int from admin_emails e join admin_actions a on a.id = e.admin_action_id
            where e.kind = 'admin_support_refund' and a.target_id = :'bd'), 2, '2e. ...each its own email');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_check_refund(%L, %L) $$, :'sup', :'be'), '42501',
  'This refund would take you past today''s $200.00 for refunds ($130.00 so far). Ask the owner with "Request a refund".', '2f. a second $130 would pass today''s $200: refused');
select is(admin_check_refund(:'sup', :'bc'), 6500, '2g. a $65 one fits ($195 in all)');
select is(admin_cancel_booking(:'bc', :'sup', 'Customer was ill.', 'confirmed', false, 6500, now(), null, null), 'cancelled', '2h. ...recorded');
select tests.clear_authentication();
select is((select count(*)::int from admin_actions where action = 'limit_reached' and target_id = :'sup' and message = 'refunds'), 1,
  '2i. the second refund reaches today''s count of 2: logged, owners told');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_check_refund(%L, %L) $$, :'sup', :'bf'), '42501',
  'You''ve reached today''s limit of 2 refunds. Ask the owner with "Request a refund".', '2j. a third refund today is refused before Stripe');
select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'Third', 'confirmed', false, 0, now(), null, null) $$, :'bf', :'sup'), '42501', NULL,
  '2k. ...and at the record, while no money has moved');
-- Once a daily limit is reached, support may ask even under $150.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select lives_ok(format($$ select admin_request_create('refund', %L, null, 'Limit reached; customer was ill.') $$, :'bf'), '2l. support asks the owner for a $130 refund instead');
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Within my limit.') $$, :'bg'), '23514', NULL,
  '2m. someone with refunds left today is still told to refund it directly');
-- My limits.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((admin_my_limits() -> 'refunds' ->> 'used') || '/' || (admin_my_limits() -> 'refunds' ->> 'limit'), '2/2', '2n. support''s limits: 2 of 2 refunds');
select is((admin_my_limits() -> 'refund_cents' ->> 'used')::int, 19500, '2o. ...$195 refunded');
select is((admin_my_limits() ->> 'limited')::boolean, true, '2p. ...limited');
-- A new Atlanta day: the counts start again.
select tests.clear_authentication();
alter table admin_actions disable trigger admin_actions_append_only;
update admin_actions set created_at = admin_day_start() - interval '1 minute' where admin_id = :'sup' and action = 'cancel_booking';
alter table admin_actions enable trigger admin_actions_append_only;
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_check_refund(:'sup', :'bg'), 13000, '2q. refunds from before Atlanta''s midnight don''t count today');
select ok(admin_day_start() <= now() and admin_day_start() > now() - interval '1 day', '2r. today starts at most a day ago');
select is(to_char(admin_day_start() at time zone 'America/New_York', 'HH24:MI'), '00:00', '2s. ...at midnight in Atlanta');
-- An approved request's refund doesn't count against the asker, and the owner has no daily limit.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select is(admin_check_refund(:'owner', :'bg'), 13000, '2t. the owner: no daily limit');
select tests.clear_authentication();

-- Refunds in flight: reserved before Stripe, counted until recorded or for 15 minutes.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup2_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_check_refund(:'sup2', :'bh'), 13000, '2u. sup2 starts a $130 refund (not recorded yet)');
select is((select count(*)::int from admin_refund_holds where admin_id = :'sup2' and booking_id = :'bh'), 1, '2v. ...reserved');
select is(admin_check_refund(:'sup2', :'bh'), 13000, '2w. retrying the same refund isn''t counted against itself');
select is((select count(*)::int from admin_refund_holds where admin_id = :'sup2'), 1, '2x. ...still one reservation');
select throws_ok(format($$ select admin_check_refund(%L, %L) $$, :'sup2', :'bi'), '42501',
  'This refund would take you past today''s $200.00 for refunds ($130.00 so far). Ask the owner with "Request a refund".',
  '2y. a second refund started before the first is recorded counts it: refused');
select tests.clear_authentication();
update admin_refund_holds set created_at = now() - interval '16 minutes' where admin_id = :'sup2';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup2_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_check_refund(:'sup2', :'bi'), 13000, '2z. a reservation never completed lapses after 15 minutes');
select is(admin_cancel_booking(:'bi', :'sup2', 'Customer was ill.', 'confirmed', false, 13000, now(), null, null), 'cancelled', '2z2. the refund is recorded');
select tests.clear_authentication();
select is((select count(*)::int from admin_refund_holds where admin_id = :'sup2' and booking_id = :'bi'), 0, '2z3. ...and its reservation is gone');
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select is((select count(*)::int from admin_refund_holds), 0, '2z4. support can''t read the reservations');
select tests.clear_authentication();
-- A refund Stripe refused: its hold released at once (the server calls admin_release_refund_hold).
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup2_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_check_refund(:'sup2', :'bj'), 6500, '2z5. sup2 starts a $65 refund ($195 with the $130 recorded)');
select lives_ok(format($$ select admin_release_refund_hold(%L, %L) $$, :'sup2', :'bj'), '2z6. Stripe refuses it: the server releases its hold');
select is((select count(*)::int from admin_refund_holds where booking_id = :'bj'), 0, '2z7. ...gone at once, not after 15 minutes');
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select throws_ok(format($$ select admin_release_refund_hold(%L, %L) $$, :'sup2', :'bj'), '42501', NULL, '2z8. releasing a hold is the server''s alone');
-- The record's other paths clear the hold too, so a refund is never counted twice.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup2_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_check_refund(:'sup2', :'bj'), 6500, '2z9. sup2 starts the refund again');
select tests.clear_authentication();
-- Recorded elsewhere without its log (as a finished lost reply can leave it).
update private.booking_records set status = 'cancelled', cancelled_by = 'admin', status_changed_by = 'admin', cancel_reason = 'Customer was ill.',
  cancelled_at = now(), refunded_cents = total_cents, refunded_at = now() where id = :'bj';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup2_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_cancel_booking(:'bj', :'sup2', 'Customer was ill.', 'confirmed', false, 6500, now(), null, null), 'logged', '2z10. the record''s "logged" path');
select tests.clear_authentication();
select is((select count(*)::int from admin_refund_holds where booking_id = :'bj'), 0, '2z11. ...clears the hold');
insert into admin_refund_holds (admin_id, booking_id, amount_cents) values (:'sup2', :'bj', 6500);
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup2_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_cancel_booking(:'bj', :'sup2', 'Customer was ill.', 'confirmed', false, 6500, now(), null, null), 'already cancelled', '2z12. the "already cancelled" path');
select tests.clear_authentication();
select is((select count(*)::int from admin_refund_holds where booking_id = :'bj'), 0, '2z13. ...clears it too');

-- ---------------------------------------------------------------------------
-- 3. Requests: today's limit
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select lives_ok(format($$ select admin_request_create('suspend_provider', null, %L, 'Three no-shows this month.') $$, :'p'), '3a. support''s second request today');
select tests.clear_authentication();
select is((select count(*)::int from admin_actions where action = 'limit_reached' and target_id = :'sup' and message = 'requests'), 1,
  '3b. reaching today''s 2 requests is logged, owners told');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'One more today.') $$, :'bg'), '42501',
  'You''ve reached today''s limit of 2 requests. Talk to the owner.', '3c. a third request today is refused');

-- ---------------------------------------------------------------------------
-- 4. Who can call what
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select throws_ok($$ select admin_my_limits() $$, '42501', 'Admins only.', '4a. a customer has no limits to see');
select throws_ok(format($$ select admin_provider_contact(%L) $$, :'p'), '42501', 'Admins only.', '4b. ...nor a provider''s email');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_daily_refund_refusal(%L, 100) $$, :'sup'), '42501', NULL, '4c. the limit helpers are the functions'' own');
select throws_ok(format($$ select * from admin_usage_today(%L) $$, :'sup2'), '42501', NULL, '4d. ...nobody reads another''s usage');
select throws_ok(format($$ select admin_limit_reached(%L, 'refunds') $$, :'sup'), '42501', NULL, '4e. ...or raises an alert by hand');

select * from finish();
rollback;
