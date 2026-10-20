-- Admin roles, step 5b (migration admin_requests; docs/design/admin-roles.md):
-- the refund limit on what's left of a charge, support's requests, the
-- owner's decisions, and the history naming who asked and who approved.
begin;
\ir _helpers/users.psql
select plan(85);

select tests.create_user('ar-owner@test.local') as owner \gset
select tests.create_user('ar-owner2@test.local') as owner2 \gset
select tests.create_user('ar-support@test.local') as sup \gset
select tests.create_user('ar-support2@test.local') as sup2 \gset
select tests.create_user('ar-provider@test.local') as powner \gset
select tests.create_user('ar-customer@test.local') as cust \gset
select id as atl from cities where slug = 'atlanta' \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
select tests.make_admin(:'sup2', 'support') as sup2_session \gset
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup', :'sup2');
insert into auth.sessions (id, user_id, aal, created_at, updated_at) values (gen_random_uuid(), :'cust', 'aal2', now(), now()) returning id as cust_session \gset

insert into providers (owner_id, display_name, city_id) values (:'powner', 'AR Tours', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('experience', 'AR food', 'ar-food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'AR Ward') returning id as area \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p', 'experience', :'exp', :'atl', 'AR crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'area', 'draft')
returning id as le \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
select tests.make_ready(id) from listings where id in (:'le');
update listings set status = 'submitted' where id in (:'le');
update listings set status = 'live', published_at = now() where id = :'le';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le', now() + interval '7 days', 40) returning id as s1 \gset

-- Paid bookings: $195 (3 people), $130 (2), $195 with $50 refunded already ($145 left), $195 with a held payout.
select tests.authenticate_as_service_role();
create temp table bk (label text primary key, id uuid);
grant all on bk to service_role;
insert into bk select l, (reserve_experience_booking(:'s1', :'cust', n::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id
  from (values ('big', 3), ('small', 2), ('partial', 3), ('held', 3), ('pending', 1), ('report', 3), ('partial2', 3), ('lost', 3), ('race1', 3), ('race2', 3), ('race3', 3)) v(l, n);
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id in (select id from bk where label <> 'pending');
select id as big from bk where label = 'big' \gset
select id as small from bk where label = 'small' \gset
select id as partial from bk where label = 'partial' \gset
select id as held from bk where label = 'held' \gset
select id as pend from bk where label = 'pending' \gset
select id as rep from bk where label = 'report' \gset
select id as partial2 from bk where label = 'partial2' \gset
select id as lost from bk where label = 'lost' \gset
select id as race1 from bk where label = 'race1' \gset
select id as race2 from bk where label = 'race2' \gset
select id as race3 from bk where label = 'race3' \gset
select tests.clear_authentication();
update private.booking_records set refunded_cents = 5000, refunded_at = now() where id = :'partial';
-- $195 with $20 refunded earlier: $175 left, over the limit.
update private.booking_records set refunded_cents = 2000, refunded_at = now() where id = :'partial2';
update private.booking_records set payout_hold = 'refunded', payout_held_at = now() where id = :'held';
-- The reported booking has happened (with the guard off; gone at rollback).
alter table public.bookings disable trigger bookings_guard;
update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
  payout_due_at = now() + interval '23 hours', confirmed_at = now() - interval '3 days' where id = :'rep';
alter table public.bookings enable trigger bookings_guard;
update private.booking_records set problem_reported_at = now(), problem_note = 'Nobody was there at all.', payout_hold = 'problem_reported', payout_held_at = now() where id = :'rep';

-- ---------------------------------------------------------------------------
-- 1. The refund limit, on what's left of the charge
-- ---------------------------------------------------------------------------
select is((select refund_limit_cents from admin_settings), 15000, '1a. the limit is $150');
select is(admin_refundable_cents(:'big'), 19500, '1b. a paid $195 booking refunds $195');
select is(admin_refundable_cents(:'partial'), 14500, '1c. ...or what''s left of it after $50 was refunded: $145');
select is(admin_refundable_cents(:'pend'), 0, '1d. a booking not yet paid refunds nothing');

select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_check_refund(%L, %L) $$, :'sup', :'big'), '42501',
  'This refund is $195.00, over the $150.00 support can refund. Ask the owner with "Request a refund".', '1e. support: $195 is over the limit, refused before Stripe');
select is(admin_check_refund(:'sup', :'small'), 13000, '1f. support: $130 is within it');
select is(admin_check_refund(:'sup', :'partial'), 14500, '1g. support: $145 left of a $195 charge is within it (the amount left, not the total)');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select is(admin_check_refund(:'owner', :'big'), 19500, '1h. the owner: no limit');
-- The record, while no money has moved.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'Support refund', 'confirmed', false, null, now(), null, null) $$, :'big', :'sup'),
  '42501', NULL, '1i. the record refuses support over the limit too, while no money has moved');
-- p_refunded_cents is the charge's total refunded: an earlier partial refund doesn't switch the check off.
select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'Support refund', 'confirmed', false, 2000, now(), null, null) $$, :'partial2', :'sup'),
  '42501', NULL, '1i2. support cancelling a partly refunded booking above the limit, with no new refund, is refused');
select is(admin_cancel_booking(:'partial2', :'sup', 'Stripe already refunded it', 'confirmed', false, 19500, now(), null, null), 'cancelled',
  '1i3. ...but once this action''s refund has happened (more refunded than before), the record follows');
select tests.clear_authentication();
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((select refund_limit_cents from admin_settings), 15000, '1j. admins read the limit');
select throws_ok($$ update admin_settings set refund_limit_cents = 1000000 $$, '42501', 'permission denied for table admin_settings', '1k. nobody changes it through the API');
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select is((select count(*)::int from admin_settings), 0, '1l. a customer doesn''t see it');

-- ---------------------------------------------------------------------------
-- 2. The gate on the other actions
-- ---------------------------------------------------------------------------
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_release_payout(%L, %L, 'Release it', 'refunded') $$, :'held', :'sup'), '42501',
  'Releasing a payout needs the owner. Ask with "Request a release".', '2a. support can''t release a payout');
select throws_ok(format($$ select admin_resolve_problem_paid(%L, %L, 'Pay them') $$, :'rep', :'sup'), '42501', NULL, '2b. ...or pay the provider on a report');
select throws_ok(format($$ select admin_set_provider_status(%L, 'suspended', %L, 'Suspend them', null) $$, :'p', :'sup'), '42501', NULL, '2c. ...or suspend a provider');

-- ---------------------------------------------------------------------------
-- 3. Asking
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Customer was sick') $$, :'small'), '23514',
  'This refund is $130.00, within the $150.00 you can refund: do it directly.', '3a. a refund support can make isn''t asked for');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Customer was sick') $$, :'partial'), '23514', NULL,
  '3b. ...measured on what''s left ($145), not the $195 total');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'hi') $$, :'big'), '23514', 'Say why, in a few words.', '3c. a reason is required');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Customer was sick', 'Hello provider') $$, :'big'), '23514', NULL,
  '3d. a message to the provider goes with a suspension only');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Customer was sick') $$, :'pend'), '23514', 'Only a paid booking is refunded.', '3e. not an unpaid booking');
select throws_ok(format($$ select admin_request_create('release_payout', %L, null, 'Release it now') $$, :'rep'), '23514',
  'A customer reported a problem: ask to resolve the report instead.', '3f. a report''s hold is resolved, not released');
select throws_ok(format($$ select admin_request_create('reinstate_provider', null, %L, 'Bring them back') $$, :'p'), '23514', 'This provider is already active.', '3g. not a reinstatement of an active provider');
select lives_ok(format($$ select admin_request_create('refund', %L, null, 'Customer was sick') $$, :'big'), '3h. support asks for a $195 refund');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Asking twice') $$, :'big'), '23514', 'There''s already a request waiting for this.', '3i. once');
select lives_ok(format($$ select admin_request_create('release_payout', %L, null, 'Refund was reversed') $$, :'held'), '3j. ...a payout release');
select lives_ok(format($$ select admin_request_create('resolve_problem_paid', %L, null, 'Photos show they were there') $$, :'rep'), '3k. ...paying the provider on a report');
select lives_ok(format($$ select admin_request_create('suspend_provider', null, %L, 'Three no-shows this month', 'Please call us.') $$, :'p'), '3l. ...a suspension, with a message to the provider');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Owner asking') $$, :'small'), '23514', 'You''re the owner: do it directly.', '3m. the owner doesn''t ask');
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Customer asking') $$, :'big'), '42501', NULL, '3n. not a customer');
select tests.authenticate_as_anon();
select throws_ok(format($$ select admin_request_create('refund', %L, null, 'Visitor asking') $$, :'big'), '42501', 'permission denied for function admin_request_create', '3o. not a visitor');

select tests.clear_authentication();
select id as r_refund from admin_requests where booking_id = :'big' and kind = 'refund' \gset
select id as r_release from admin_requests where booking_id = :'held' \gset
select id as r_paid from admin_requests where booking_id = :'rep' \gset
select id as r_suspend from admin_requests where provider_id = :'p' \gset
select is((select amount_cents from admin_requests where id = :'r_refund'), 19500, '3p. the refund''s amount when asked is kept');
select is((select count(*)::int from admin_notifications where admin_request_id = :'r_refund' and kind = 'request_new' and recipient_id in (:'owner', :'owner2')), 2,
  '3q. every owner''s bell has it');
select is((select count(*)::int from admin_emails e join admin_actions a on a.id = e.admin_action_id where a.request_id = :'r_refund' and e.kind = 'admin_request_new'), 2,
  '3r. ...and every owner is emailed');
select is((select count(*)::int from admin_notifications where admin_request_id = :'r_refund' and recipient_id = :'sup'), 0, '3s. not the asker');

-- Who reads them.
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select is((select count(*)::int from admin_requests), 0, '3t. other support members don''t see them');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((select count(*)::int from admin_requests), 4, '3u. the asker sees theirs');
select throws_ok(format($$ update admin_requests set status = 'approved' where id = %L $$, :'r_refund'), '42501', NULL, '3v. nobody writes a request directly');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is((select (admin_requests_page('open') ->> 'open_total')::int), 4, '3w. the owner''s list has all four waiting');

-- ---------------------------------------------------------------------------
-- 4. Deciding
-- ---------------------------------------------------------------------------
-- Declining: the owner, with a note the asker sees.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_request_decline(%L, 'Not now') $$, :'r_paid'), '42501', 'Only the owner can decline a request.', '4a. support doesn''t decide');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select admin_request_decline(%L, 'no') $$, :'r_paid'), '23514', NULL, '4b. a note is required');
select is(admin_request_decline(:'r_paid', 'The customer''s photos show nobody there.'), 'declined', '4c. the owner declines, with a note');
select tests.clear_authentication();
select is((select status || '/' || decided_by::text from admin_requests where id = :'r_paid'), 'declined/' || :'owner', '4d. ...recorded');
select is((select count(*)::int from admin_notifications where admin_request_id = :'r_paid' and kind = 'request_decided' and recipient_id = :'sup'), 1, '4e. ...and the asker is told');

-- Approving: the action, as the owner, closes the request in its own transaction.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_release_payout(%L, %L, 'Approving my own', 'refunded', %L) $$, :'held', :'sup', :'r_release'), '42501', NULL,
  '4f. support can''t approve, even their own');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select is(admin_request_for_approval(:'owner', :'r_refund') ->> 'current_amount_cents', '19500', '4g. approving shows the refund now');
select ok(admin_release_payout(:'held', :'owner', 'Refund was reversed', 'refunded', :'r_release'), '4h. the owner approves the release');
select throws_ok(format($$ select admin_release_payout(%L, %L, 'Again', 'refunded', %L) $$, :'held', :'owner', :'r_release'), '23514', NULL,
  '4i. an approved request isn''t approved again (nothing held, and it isn''t waiting)');
select tests.clear_authentication();
select is((select status || '/' || decided_by::text || '/' || result from admin_requests where id = :'r_release'), 'approved/' || :'owner' || '/Payout released.', '4j. the request is approved, by the owner');
select is((select admin_id::text || '/' || reason from admin_actions where action = 'release_payout' and target_id = :'held' and request_id = :'r_release'),
  :'owner' || '/Refund was reversed', '4k. the history: the owner did it, on the request (whose asker is recorded)');
select is((select r.requested_by from admin_actions a join admin_requests r on r.id = a.request_id where a.action = 'release_payout' and a.target_id = :'held'),
  :'sup'::uuid, '4l. ...naming who asked');

-- The refund's amount changed before approval: approving reads it now.
update private.booking_records set refunded_cents = 2000, refunded_at = now() where id = :'big';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select is((admin_request_for_approval(:'owner', :'r_refund') ->> 'amount_cents') || '/' || (admin_request_for_approval(:'owner', :'r_refund') ->> 'current_amount_cents'),
  '19500/17500', '4m. approving shows the amount when asked and now, when they differ');
-- (Stripe's refund brings the charge's total refunded to $195.)
select is(admin_cancel_booking(:'big', :'owner', 'Customer was sick', 'confirmed', false, 19500, now(), null, null, :'r_refund'), 'cancelled', '4n. the owner approves the refund');
select tests.clear_authentication();
select is((select status || '/' || result from admin_requests where id = :'r_refund'), 'approved/Cancelled and refunded $175.00.', '4o. ...the request says what was refunded');

-- An approved refund whose reply was lost, finished from Stripe's metadata
-- with no admin session (x-lokl-finishing): the request closes as approved.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select lives_ok(format($$ select admin_request_create('refund', %L, null, 'Lost reply refund') $$, :'lost'), '4o2. support asks for another refund');
select tests.clear_authentication();
select id as r_lost from admin_requests where booking_id = :'lost' \gset
select set_config('request.headers', json_build_object('x-lokl-finishing', 'stripe')::text, true);
select tests.authenticate_as_service_role();
select is(admin_cancel_booking(:'lost', :'owner', 'Lost reply refund', 'confirmed', false, 19500, now(), null, null, :'r_lost'), 'cancelled',
  '4o3. finishing it from Stripe, without the owner''s session, records it');
select tests.clear_authentication();
select is((select status || '/' || decided_by::text from admin_requests where id = :'r_lost'), 'approved/' || :'owner', '4o4. ...and closes the request as approved by the owner');
select set_config('request.headers', json_build_object('x-lokl-finishing', 'stripe')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'Finishing as support', 'confirmed', false, 19500, now(), null, null, %L) $$, :'small', :'sup', :'r_lost'),
  '42501', 'Only the owner can approve a request.', '4o5. finishing never approves a request for support');
select set_config('request.headers', '{}', true);
select tests.clear_authentication();

-- Races after Stripe has refunded: closing the request never blocks the record.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select lives_ok(format($$ select admin_request_create('refund', %L, null, 'Race one refund') $$, :'race1'), '4o6. support asks for a refund');
select lives_ok(format($$ select admin_request_create('refund', %L, null, 'Race two refund') $$, :'race2'), '4o7. ...and another');
select tests.clear_authentication();
select id as r_race1 from admin_requests where booking_id = :'race1' \gset
select id as r_race2 from admin_requests where booking_id = :'race2' \gset
-- Withdrawn after the owner approved, before the record.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is(admin_request_withdraw(:'r_race1'), 'withdrawn', '4o8. support withdraws it while Stripe is refunding');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_cancel_booking(%L, %L, 'Race one refund', 'confirmed', false, 0, now(), null, null, %L) $$, :'race1', :'owner', :'r_race1'),
  '23514', 'That request isn''t waiting for a decision any more.', '4o9. before any money moves, a request no longer waiting refuses the approval');
select is(admin_cancel_booking(:'race1', :'owner', 'Race one refund', 'confirmed', false, 19500, now(), null, null, :'r_race1'), 'cancelled',
  '4o10. after Stripe refunded, the record is written anyway');
select tests.clear_authentication();
select is((select status from admin_requests where id = :'r_race1'), 'withdrawn', '4o11. ...the request left as it is (withdrawn)');
select is((select request_id from admin_actions where action = 'cancel_booking' and target_id = :'race1'), :'r_race1'::uuid, '4o12. ...and its id kept on the action');
-- Expired after the owner approved, before the record.
alter table admin_requests disable trigger admin_requests_guard;
update admin_requests set created_at = now() - interval '7 days 1 minute' where id = :'r_race2';
alter table admin_requests enable trigger admin_requests_guard;
select admin_requests_expire();
select is((select status from admin_requests where id = :'r_race2'), 'expired', '4o13. a request expires while Stripe is refunding');
select set_config('request.headers', json_build_object('x-lokl-finishing', 'stripe')::text, true);
select tests.authenticate_as_service_role();
select is(admin_cancel_booking(:'race2', :'owner', 'Race two refund', 'confirmed', false, 19500, now(), null, null, :'r_race2'), 'cancelled',
  '4o14. finishing from Stripe records it anyway');
select tests.clear_authentication();
select is((select status || '/' || coalesce((select request_id::text from admin_actions where action = 'cancel_booking' and target_id = :'race2'), '-')
             from admin_requests where id = :'r_race2'), 'expired/' || :'r_race2', '4o15. ...the request left expired, its id on the action');
select set_config('request.headers', '{}', true);

-- A paid-out booking whose refund was already recorded: this action's
-- Stripe effect is the transfer reversal, and that counts as money moved.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select lives_ok(format($$ select admin_request_create('refund', %L, null, 'Race three refund') $$, :'race3'), '4o16. support asks to refund a paid-out booking');
select tests.clear_authentication();
select id as r_race3 from admin_requests where booking_id = :'race3' \gset
alter table public.bookings disable trigger bookings_guard;
update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour', confirmed_at = now() - interval '3 days' where id = :'race3';
alter table public.bookings enable trigger bookings_guard;
update private.booking_records set status = 'completed', status_changed_by = 'system' where id = :'race3';
update private.booking_records set status = 'paid_out', stripe_transfer_id = 'tr_test_race3', status_changed_by = 'system' where id = :'race3';
update private.booking_records set refunded_cents = total_cents, refunded_at = now() where id = :'race3';
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is(admin_request_withdraw(:'r_race3'), 'withdrawn', '4o17. support withdraws it as the transfer is reversed');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_cancel_booking(:'race3', :'owner', 'Race three refund', 'paid_out', false, 19500, now(), 'trr_test_race3', null, :'r_race3'), 'cancelled',
  '4o18. no new refund, but a reversal: the record is written anyway');
select tests.clear_authentication();
select is((select status || '/' || coalesce((select request_id::text from admin_actions where action = 'cancel_booking' and target_id = :'race3'), '-')
             from admin_requests where id = :'r_race3'), 'withdrawn/' || :'r_race3', '4o19. ...the request left withdrawn, its id on the action');
select set_config('request.headers', '{}', true);

-- The owner acting directly closes a matching request.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select ok(admin_set_provider_status(:'p', 'suspended', :'owner', 'Three no-shows', null), '4p. the owner suspends the provider directly');
select tests.clear_authentication();
select is((select status || '/' || decided_by::text from admin_requests where id = :'r_suspend'), 'done_by_owner/' || :'owner', '4q. the waiting request is done by the owner');
select is((select count(*)::int from admin_notifications where admin_request_id = :'r_suspend' and kind = 'request_decided' and recipient_id = :'sup'), 1, '4r. ...and the asker told');

-- ---------------------------------------------------------------------------
-- 5. Withdrawing, expiry, and the record
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select lives_ok(format($$ select admin_request_create('reinstate_provider', null, %L, 'They called us back') $$, :'p'), '5a. support asks to reinstate');
select tests.clear_authentication();
select id as r_reinstate from admin_requests where provider_id = :'p' and kind = 'reinstate_provider' \gset
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select throws_ok(format($$ select admin_request_withdraw(%L) $$, :'r_reinstate'), 'P0002', NULL, '5b. only the asker withdraws it');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is(admin_request_withdraw(:'r_reinstate'), 'withdrawn', '5c. the asker withdraws it');

-- A request left 7 days lapses.
select lives_ok(format($$ select admin_request_create('reinstate_provider', null, %L, 'Asking again now') $$, :'p'), '5d. ...and asks again');
select tests.clear_authentication();
select id as r_old from admin_requests where provider_id = :'p' and kind = 'reinstate_provider' and status = 'pending' \gset
alter table admin_requests disable trigger admin_requests_guard;
update admin_requests set created_at = now() - interval '7 days 1 minute' where id = :'r_old';
alter table admin_requests enable trigger admin_requests_guard;
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select is(admin_request_for_approval(:'owner', :'r_old') ->> 'status', 'expired', '5e. after 7 days it''s expired, not approved');
select tests.clear_authentication();
select throws_ok(format($$ update admin_requests set reason = 'A different reason' where id = %L $$, :'r_old'), '23514',
  'A request''s decision is written once, and nothing else about it changes.', '5f. a decided request never changes (the runner included)');
select throws_ok(format($$ delete from admin_requests where id = %L $$, :'r_old'), '23514', 'Requests are never deleted.', '5g. requests are never deleted');

-- Names in a history.
select tests.authenticate_as(:'sup2', null, 'aal2', :'sup2_session');
select is((select string_agg(email, ',' order by email) from admin_member_names(array[:'owner', :'sup', :'cust']::uuid[])),
  'ar-owner@test.local,ar-support@test.local', '5h. any admin reads team members'' names by id, never anyone else''s');
select tests.authenticate_as(:'cust', null, 'aal2', :'cust_session');
select throws_ok(format($$ select * from admin_member_names(array[%L]::uuid[]) $$, :'owner'), '42501', NULL, '5i. not a customer');

select * from finish();
rollback;
