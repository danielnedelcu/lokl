-- Reviews and star ratings (migration reviews; docs/design/reviews.md):
-- the reviewer's name; who can review, edit and delete, and when; what
-- visitors, customers, providers and admins can read; replies; reports;
-- the rating totals; the emails, bell and reminders; moderation; and a
-- review kept when its booking is cancelled afterwards.
begin;
\ir _helpers/users.psql
select plan(117);

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('peach@test.local') as owner1 \gset
select tests.create_user('quiet@test.local') as owner2 \gset
select tests.create_user('sam@test.local') as cust \gset
select tests.create_user('ann@test.local') as cust2 \gset
select tests.create_user('stranger@test.local') as stranger \gset
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = :'admin';
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'owner1', 'Peach Tours', :'atl') returning id as p1 \gset
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Quiet Walks', :'atl') returning id as p2 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

create function pg_temp.listing(p_provider uuid, p_title text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
  values (p_provider, 'experience', (select id from public.categories where slug = 'food'), (select id from public.cities where slug = 'atlanta'),
          p_title, 'A listing made for the review tests, long enough.', 5000, 60,
          (select id from public.service_areas where name = 'Old Fourth Ward'), 'submitted') returning id into v;
  insert into public.listing_photos (listing_id, storage_path, position, alt_text) values (v, p_provider || '/' || v || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
  update public.listings set status = 'live', published_at = now() where id = v;
  return v;
end;
$$;
select pg_temp.listing(:'p1', 'Taco crawl') as le1 \gset
select pg_temp.listing(:'p1', 'Mural ride') as le2 \gset
select pg_temp.listing(:'p2', 'Garden walk') as le3 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le1', now() + interval '7 days', 50) returning id as s1 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le2', now() + interval '7 days', 50) returning id as s2 \gset
insert into experience_sessions (listing_id, starts_at, capacity) values (:'le3', now() + interval '7 days', 50) returning id as s3 \gset

-- Bookings, made as checkout makes them, then moved to the state each test needs.
select tests.authenticate_as_service_role();
create temp table bk (label text primary key, id uuid);
grant all on bk to public;
insert into bk select 'done', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam taylor-brown', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'paid', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam taylor-brown', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'reportpaid', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam taylor-brown', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'other', (reserve_experience_booking(:'s1', :'cust2', 1::smallint, 'ANN LEE', 'ann@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'second', (reserve_experience_booking(:'s2', :'cust', 1::smallint, 'sam taylor-brown', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'cancelled', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'latecancel', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'reportopen', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'old', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'notended', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'fresh', (reserve_experience_booking(:'s1', :'cust', 1::smallint, '  123 😀 ', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'remind', (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
insert into bk select 'quiet', (reserve_experience_booking(:'s3', :'cust', 1::smallint, 'sam', 'sam@test.local', null, null, now() + interval '30 minutes')).id;
select tests.clear_authentication();

alter table bookings disable trigger bookings_guard;
-- A booking that took place: it started `ago` ago and lasted an hour.
create function pg_temp.happened(p_label text, p_status text, p_ago interval) returns void
language sql as $$
  update public.bookings set status = p_status, status_changed_by = 'system',
    starts_at = now() - p_ago, ends_at = now() - p_ago + interval '1 hour',
    confirmed_at = now() - p_ago - interval '3 days', payout_due_at = now() - p_ago + interval '25 hours'
  where id = (select id from bk where label = p_label);
$$;
select pg_temp.happened('done', 'completed', interval '2 days');
select pg_temp.happened('paid', 'paid_out', interval '3 days');
select pg_temp.happened('reportpaid', 'completed', interval '2 days');
update bookings set problem_reported_at = now() - interval '47 hours', problem_resolution = 'paid_provider', problem_resolved_at = now() - interval '1 hour'
  where id = (select id from bk where label = 'reportpaid');
select pg_temp.happened('other', 'completed', interval '2 days');
select pg_temp.happened('second', 'completed', interval '2 days');
select pg_temp.happened('cancelled', 'cancelled', interval '2 days');
update bookings set cancelled_at = now() - interval '3 days', cancelled_by = 'admin' where id = (select id from bk where label = 'cancelled');
select pg_temp.happened('latecancel', 'paid_out', interval '2 days');
update bookings set cancelled_at = now() - interval '3 days', cancelled_by = 'customer' where id = (select id from bk where label = 'latecancel');
select pg_temp.happened('reportopen', 'completed', interval '2 days');
update bookings set problem_reported_at = now() - interval '47 hours' where id = (select id from bk where label = 'reportopen');
select pg_temp.happened('old', 'completed', interval '20 days');
select pg_temp.happened('remind', 'completed', interval '11 days');
select pg_temp.happened('quiet', 'completed', interval '2 days');
-- Not ended: confirmed, in two days.
update bookings set status = 'confirmed', status_changed_by = 'stripe', starts_at = now() + interval '2 days', ends_at = now() + interval '2 days 1 hour',
  confirmed_at = now(), payout_due_at = now() + interval '3 days 1 hour' where id = (select id from bk where label = 'notended');
-- Fresh: confirmed and ended, about to be completed by the pay-out job (below).
update bookings set status = 'confirmed', status_changed_by = 'stripe', starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours',
  confirmed_at = now() - interval '1 day', payout_due_at = now() + interval '22 hours' where id = (select id from bk where label = 'fresh');
select id as b_done from bk where label = 'done' \gset
select id as b_paid from bk where label = 'paid' \gset
select id as b_reportpaid from bk where label = 'reportpaid' \gset
select id as b_other from bk where label = 'other' \gset
select id as b_second from bk where label = 'second' \gset
select id as b_cancelled from bk where label = 'cancelled' \gset
select id as b_latecancel from bk where label = 'latecancel' \gset
select id as b_reportopen from bk where label = 'reportopen' \gset
select id as b_old from bk where label = 'old' \gset
select id as b_notended from bk where label = 'notended' \gset
select id as b_fresh from bk where label = 'fresh' \gset
select id as b_remind from bk where label = 'remind' \gset
select id as b_quiet from bk where label = 'quiet' \gset

-- ---------------------------------------------------------------------------
-- 1. The reviewer's name
-- ---------------------------------------------------------------------------
select is(review_display_name('sam taylor-brown'), 'Sam T.', '1a. first name and the last word''s initial, capitals tidied');
select is(review_display_name('SAM'), 'Sam', '1b. one word, shown as is, capitals tidied');
select is(review_display_name('DeShawn Jones'), 'DeShawn J.', '1c. mixed case is left as typed');
select is(review_display_name('José María López'), 'José L.', '1d. letters of any alphabet');
select is(review_display_name('mary-jane o''neil'), 'Mary-Jane O.', '1e. a capital after a hyphen; apostrophes kept');
select is(review_display_name('  cher  '), 'Cher', '1f. spaces trimmed');
select is(review_display_name('123 😀 !!'), 'A lokl customer', '1g. nothing usable: the fallback');
select is(review_display_name(null), 'A lokl customer', '1h. no name: the fallback');
select is(review_display_name('sam 2 😀'), 'Sam', '1i. words with no letters are dropped');

-- ---------------------------------------------------------------------------
-- 2. Writing a review
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'cust');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 5, 'Great food and a lovely walk, well worth it.') $$, :'b_done'),
  '2a. a customer reviews their completed booking');
select tests.clear_authentication();
select is((select reviewer_name from reviews where booking_id = :'b_done'), 'Sam T.', '2b. ...shown as their tidied name');
select results_eq(format($$ select listing_id, provider_id, customer_id, booking_month, status from reviews where booking_id = %L $$, :'b_done'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid, date_trunc('month', (now() - interval '2 days') at time zone 'America/New_York')::date, 'published'::text) $$, :'le1', :'p1', :'cust'),
  '2c. the listing, provider, customer and month are copied from the booking');
select tests.authenticate_as(:'cust');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 4, 'Writing a second review for the same booking.') $$, :'b_done'),
  '23505', null, '2d. once per booking');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 1, 'Reviewing someone else''s booking, which is not allowed.') $$, :'b_other'),
  '42501', null, '2e. not someone else''s booking');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 1, 'This booking was cancelled, so it does not qualify.') $$, :'b_cancelled'),
  '42501', null, '2f. not a cancelled booking');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 1, 'A late cancel that was paid out still does not qualify.') $$, :'b_latecancel'),
  '42501', null, '2g. not a late cancel that was paid out');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 1, 'The no-show report on this booking is still open.') $$, :'b_reportopen'),
  '42501', null, '2h. not while a no-show report is open');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 3, 'This booking ended twenty days ago, past the window.') $$, :'b_old'),
  '42501', null, '2i. not after the 14-day window');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 3, 'This booking has not happened yet, so it can''t be reviewed.') $$, :'b_notended'),
  '42501', null, '2j. not before the booking has ended');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 5, 'Paid out and reviewed after it was done, all good.') $$, :'b_paid'),
  '2k. a paid-out booking qualifies');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 5, 'The report was settled for the provider; a fine walk.') $$, :'b_reportpaid'),
  '2l. a report resolved as "pay the provider" lets the review go ahead');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 3, 'Too short') $$, :'b_second'),
  '23514', null, '2m. at least 20 characters');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 3, 'Call me on 404 555 0123 to hear more about it.') $$, :'b_second'),
  '23514', null, '2n. no contact details');
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 6, 'Six stars for a five star scale is not a thing.') $$, :'b_second'),
  '23514', null, '2o. one to five stars');
select throws_ok(format($$ insert into reviews (booking_id, rating, body, listing_id) values (%L, 3, 'Trying to point the review at another listing.', %L) $$, :'b_second', :'le3'),
  '42501', null, '2p. the copied columns can''t be sent');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 1, 'The mural ride was cancelled halfway, disappointing.') $$, :'b_second'),
  '2q. a review of another listing of the same provider');
select tests.authenticate_as(:'cust2');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 4, 'Good tacos, the walk was a bit long for us though.') $$, :'b_other'),
  '2r. another customer reviews their own booking');
select tests.clear_authentication();
select is((select reviewer_name from reviews where booking_id = :'b_other'), 'Ann L.', '2s. ...as "Ann L." (from "ANN LEE")');
select tests.authenticate_as(:'cust');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 5, 'A quiet garden walk with a lovely guide.') $$, :'b_quiet'),
  '2t. a review for the other provider');
select tests.clear_authentication();
set local role anon;
select throws_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 5, 'Visitors can''t write reviews at all, ever.') $$, :'b_done'),
  '42501', null, '2u. visitors can''t write');
reset role;
select id as r_done from reviews where booking_id = :'b_done' \gset
select id as r_paid from reviews where booking_id = :'b_paid' \gset
select id as r_other from reviews where booking_id = :'b_other' \gset
select id as r_second from reviews where booking_id = :'b_second' \gset
select id as r_quiet from reviews where booking_id = :'b_quiet' \gset

-- ---------------------------------------------------------------------------
-- 3. Reading
-- ---------------------------------------------------------------------------
set local role anon;
select is((select count(*)::int from reviews where provider_id = :'p1'), 5, '3a. visitors read a public provider''s published reviews');
select throws_ok($$ select customer_id from reviews $$, '42501', null, '3b. ...but not who wrote them');
select throws_ok($$ select booking_id from reviews $$, '42501', null, '3c. ...nor the booking');
reset role;
select tests.authenticate_as(:'stranger');
select is((select count(*)::int from reviews where provider_id = :'p1'), 5, '3d. signed-in people read them too');
select throws_ok($$ select customer_id from reviews $$, '42501', null, '3e. ...but not who wrote them');
select throws_ok($$ select removed_reason from reviews $$, '42501', null, '3f. ...nor an admin''s note');

-- ---------------------------------------------------------------------------
-- 4. Editing and deleting
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'cust');
update reviews set body = 'Great food and a lovely walk. The guide knew everyone.' where id = :'r_done';
select isnt((select edited_at from reviews where id = :'r_done'), null, '4a. a customer edits their review; it''s marked edited');
select throws_ok(format($$ update reviews set status = 'removed' where id = %L $$, :'r_done'), '42501', null, '4b. ...but not its status');
select tests.authenticate_as(:'cust2');
update reviews set rating = 1 where id = :'r_done';
select tests.authenticate_as(:'owner1');
update reviews set rating = 1 where id = :'r_done';
select tests.clear_authentication();
select is((select rating from reviews where id = :'r_done')::int, 5, '4c. another customer and the provider can''t change it');
-- The window closes: the booking ended 15 days ago.
select pg_temp.happened('second', 'completed', interval '15 days');
select tests.authenticate_as(:'cust');
update reviews set rating = 2 where id = :'r_second';
delete from reviews where id = :'r_second';
select tests.clear_authentication();
select results_eq(format($$ select rating::int from reviews where id = %L $$, :'r_second'), $$ values (1) $$,
  '4d. after the window, no edits or deletes');
select pg_temp.happened('second', 'completed', interval '2 days');
select tests.authenticate_as(:'cust');
delete from reviews where id = :'r_second';
select is((select count(*)::int from reviews where id = :'r_second'), 0, '4e. within the window, a customer deletes their review');
select lives_ok(format($$ insert into reviews (booking_id, rating, body) values (%L, 2, 'Second try: the ride was cut short, two stars.') $$, :'b_second'),
  '4f. ...and can write again');
select tests.clear_authentication();
select id as r_second from reviews where booking_id = :'b_second' \gset

-- ---------------------------------------------------------------------------
-- 5. Replies
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'owner1');
select lives_ok(format($$ insert into review_replies (review_id, body) values (%L, 'Thanks Sam, glad you enjoyed it!') $$, :'r_done'),
  '5a. the provider replies to a review of their business');
select tests.clear_authentication();
select is((select provider_id from review_replies where review_id = :'r_done'), :'p1'::uuid, '5b. ...the provider copied from the review');
select tests.authenticate_as(:'owner1');
select throws_ok(format($$ insert into review_replies (review_id, body) values (%L, 'A second reply.') $$, :'r_done'), '23505', null, '5c. one reply per review');
update review_replies set body = 'Thanks Sam, glad you enjoyed the walk!' where review_id = :'r_done';
select isnt((select edited_at from review_replies where review_id = :'r_done'), null, '5d. the reply is edited, and marked');
select throws_ok(format($$ insert into review_replies (review_id, body) values (%L, 'Call us on 404-555-0199 any time.') $$, :'r_paid'),
  '23514', null, '5e. no contact details in a reply');
select tests.authenticate_as(:'owner2');
select throws_ok(format($$ insert into review_replies (review_id, body) values (%L, 'Replying to another business''s review.') $$, :'r_paid'),
  '42501', null, '5f. not to another business''s review');
select tests.authenticate_as(:'cust');
select throws_ok(format($$ insert into review_replies (review_id, body) values (%L, 'The customer replying to their own review.') $$, :'r_paid'),
  '42501', null, '5g. not by the customer');
select tests.clear_authentication();
set local role anon;
select is((select body from review_replies where review_id = :'r_done'), 'Thanks Sam, glad you enjoyed the walk!', '5h. visitors read the reply');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Reports
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'stranger');
select lives_ok(format($$ insert into review_reports (review_id, rule, note) values (%L, 'off_topic', 'This is about a different walk.') $$, :'r_other'),
  '6a. anyone signed in reports a review');
select throws_ok(format($$ insert into review_reports (review_id, rule) values (%L, 'spam') $$, :'r_other'), '23505', null, '6b. once per person');
select lives_ok(format($$ insert into review_reports (review_id, target, rule) values (%L, 'reply', 'abuse') $$, :'r_done'), '6c. a reply can be reported');
select throws_ok(format($$ insert into review_reports (review_id, target, rule) values (%L, 'reply', 'abuse') $$, :'r_paid'),
  '42501', null, '6d. not a reply that doesn''t exist');
select throws_ok(format($$ insert into review_reports (review_id, rule, status) values (%L, 'spam', 'upheld') $$, :'r_paid'),
  '42501', null, '6e. a report''s status can''t be sent');
select is((select count(*)::int from review_reports), 2, '6f. the reporter reads their own reports');
select tests.authenticate_as(:'owner1');
select lives_ok(format($$ insert into review_reports (review_id, rule, note) values (%L, 'conflict_of_interest', 'We think this is a competitor.') $$, :'r_other'),
  '6g. the provider can report a review of their business');
select is((select count(*)::int from review_reports), 1, '6h. ...and reads only their own report');
select tests.authenticate_as(:'cust');
select throws_ok(format($$ insert into review_reports (review_id, rule) values (%L, 'spam') $$, :'r_done'), '42501', null, '6i. not your own review');
select tests.clear_authentication();
set local role anon;
select throws_ok(format($$ insert into review_reports (review_id, rule) values (%L, 'spam') $$, :'r_done'), '42501', null, '6j. visitors can''t report');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Rating totals
-- ---------------------------------------------------------------------------
-- Taco crawl: 5, 5, 5, 4 → 4.75 → 4.8. Peach Tours: also the mural ride's 2.
select results_eq(format($$ select review_count, rating_average from listing_ratings where listing_id = %L $$, :'le1'),
  $$ values (4, 4.8::numeric) $$, '7a. a listing''s count and average, rounded half up (4.75 → 4.8)');
select results_eq(format($$ select review_count, rating_average from provider_ratings where provider_id = %L $$, :'p1'),
  $$ values (5, 4.2::numeric) $$, '7b. the provider''s, across their listings (21 / 5 = 4.2)');
select results_eq(format($$ select stars_1, stars_2, stars_3, stars_4, stars_5 from listing_ratings where listing_id = %L $$, :'le1'),
  $$ values (0, 0, 0, 1, 3) $$, '7b2. the listing''s count at each star level (review_star_counts)');
select results_eq(format($$ select stars_1, stars_2, stars_3, stars_4, stars_5 from provider_ratings where provider_id = %L $$, :'p1'),
  $$ values (0, 1, 0, 1, 3) $$, '7b3. ...and the provider''s');
set local role anon;
select is((select rating_average from listing_ratings where listing_id = :'le1'), 4.8::numeric, '7c. visitors read a live listing''s rating');
select throws_ok($$ select rating_total from listing_ratings $$, '42501', null, '7d. ...but not the raw total');
select is((select stars_5 from listing_ratings where listing_id = :'le1'), 3, '7d2. visitors read the star counts, for the breakdown');
reset role;
select tests.authenticate_as(:'stranger');
select is((select rating_average from provider_ratings where provider_id = :'p1'), 4.2::numeric, '7e. signed-in people read a public provider''s rating');
select tests.clear_authentication();
-- The mural ride is unlisted: still in the provider's rating, no longer readable as a listing's.
update listings set status = 'draft' where id = :'le2';
select is((select review_count from provider_ratings where provider_id = :'p1'), 5, '7f. an unlisted listing''s reviews still count for the provider');
set local role anon;
select is((select count(*)::int from listing_ratings where listing_id = :'le2'), 0, '7g. ...and its own rating isn''t public');
select is((select count(*)::int from reviews where listing_id = :'le2'), 1, '7h. ...but its review still is, on the provider''s profile');
reset role;
update listings set status = 'live' where id = :'le2';

-- ---------------------------------------------------------------------------
-- 8. Emails, the bell, reminders
-- ---------------------------------------------------------------------------
select is((select count(*)::int from booking_emails where booking_id = :'b_done' and kind = 'provider_new_review'), 1, '8a. a new review emails the provider');
select is((select count(*)::int from notifications where booking_id = :'b_done' and kind = 'review_posted'), 1, '8b. ...and rings their bell');
select is((select count(*)::int from booking_emails where booking_id = :'b_second' and kind = 'provider_new_review'), 1, '8c. a review deleted and written again emails once');
update bookings set status = 'completed', status_changed_by = 'system' where id = :'b_fresh';
select is((select count(*)::int from booking_emails where booking_id = :'b_fresh' and kind = 'customer_review_request'), 1, '8d. a booking completing asks for a review');
-- An open report: no request on completing; one when it's resolved for the provider.
update bookings set status = 'confirmed', status_changed_by = 'stripe' where id = :'b_reportopen';
update bookings set status = 'completed', status_changed_by = 'system' where id = :'b_reportopen';
select is((select count(*)::int from booking_emails where booking_id = :'b_reportopen' and kind = 'customer_review_request'), 0, '8e. not while a no-show report is open');
update bookings set problem_resolution = 'paid_provider', problem_resolved_at = now() where id = :'b_reportopen';
select is((select count(*)::int from booking_emails where booking_id = :'b_reportopen' and kind = 'customer_review_request'), 1, '8f. ...but once it''s resolved as "pay the provider"');
select is((select count(*)::int from booking_emails where booking_id = :'b_cancelled' and kind = 'customer_review_request'), 0, '8g. never for a cancelled booking');
select tests.authenticate_as_service_role();
select is(queue_review_reminders(), 1, '8h. one reminder: the booking 11 days past its end, not reviewed');
select is(queue_review_reminders(), 0, '8i. ...only once');
select tests.clear_authentication();
select is((select count(*)::int from booking_emails where booking_id = :'b_remind' and kind = 'customer_review_reminder'), 1, '8j. ...for the right booking');
select tests.authenticate_as(:'cust');
select throws_ok($$ select queue_review_reminders() $$, '42501', null, '8k. only the job queues reminders');

-- ---------------------------------------------------------------------------
-- 9. review_state()
-- ---------------------------------------------------------------------------
select is((review_state(:'b_fresh') ->> 'can_write')::boolean, true, '9a. the customer can write a review for a qualifying booking');
select is(review_state(:'b_fresh') ->> 'reviewer_name', 'A lokl customer', '9b. ...and sees the name it will show (here the fallback)');
select is((review_state(:'b_done') -> 'review' ->> 'can_change')::boolean, true, '9c. their review can be changed in the window');
select is(review_state(:'b_old') ->> 'why_not', 'window_closed', '9d. why not: the window closed');
select is(review_state(:'b_notended') ->> 'why_not', 'not_ended', '9e. why not: not ended');
select is(review_state(:'b_cancelled') ->> 'why_not', 'cancelled', '9f. why not: cancelled');
select tests.authenticate_as(:'owner1');
select is(review_state(:'b_done') ->> 'role', 'provider', '9g. the provider sees the booking''s review');
select tests.authenticate_as(:'stranger');
select is(review_state(:'b_done'), null, '9h. nobody else does');

-- ---------------------------------------------------------------------------
-- 10. Moderation
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'stranger');
select throws_ok(format($$ select admin_moderate_review(%L, %L, 'review', 'remove', 'off_topic', 'Not about this walk.') $$, :'r_other', :'admin'),
  '42501', null, '10a. only the server can moderate');
select throws_ok($$ select admin_reviews_page() $$, '42501', null, '10b. only admins read the queue');
select tests.authenticate_as_admin(:'admin');
select is((admin_reviews_page() ->> 'open_reports')::int, 2, '10c. the queue: two reviews with open reports');
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_moderate_review(%L, %L, 'review', 'remove', 'off_topic', 'Not about this walk.') $$, :'r_other', :'stranger'),
  '42501', null, '10d. the id passed must be an admin''s');
select throws_ok(format($$ select admin_moderate_review(%L, %L, 'review', 'remove', null, 'Not about this walk.') $$, :'r_other', :'admin'),
  '23514', null, '10e. a removal names the rule');
select lives_ok(format($$ select admin_moderate_review(%L, %L, 'review', 'remove', 'off_topic', 'About a different walk entirely.') $$, :'r_other', :'admin'),
  '10f. an admin removes a review under a rule');
select tests.clear_authentication();
select results_eq(format($$ select status, removed_rule from reviews where id = %L $$, :'r_other'), $$ values ('removed'::text, 'off_topic'::text) $$,
  '10g. ...it''s removed, with the rule');
select is((select count(*)::int from review_reports where review_id = :'r_other' and status = 'upheld'), 2, '10h. ...its reports upheld');
select results_eq(format($$ select action, rule from admin_actions where target = 'review' and target_id = %L $$, :'r_other'),
  $$ values ('remove_review'::text, 'off_topic'::text) $$, '10i. ...logged with the rule');
select is((select count(*)::int from booking_emails where booking_id = :'b_other' and kind = 'customer_review_removed'), 1, '10j. ...and the customer emailed');
select results_eq(format($$ select review_count, rating_average from listing_ratings where listing_id = %L $$, :'le1'),
  $$ values (3, 5.0::numeric) $$, '10k. ...and it drops out of the rating');
select is((select stars_4 from listing_ratings where listing_id = :'le1'), 0, '10k2. ...and out of its star level');
set local role anon;
select is((select count(*)::int from reviews where id = :'r_other'), 0, '10l. visitors no longer see it');
reset role;
select tests.authenticate_as(:'cust2');
select is((select status from reviews where id = :'r_other'), 'removed', '10m. its customer still sees it, removed');
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_moderate_review(%L, %L, 'review', 'restore', null, 'Removed by mistake, it is on topic.') $$, :'r_other', :'admin'),
  '10n. an admin restores it');
select tests.clear_authentication();
select is((select review_count from listing_ratings where listing_id = :'le1'), 4, '10o. ...back in the rating');
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_moderate_review(%L, %L, 'reply', 'keep', null, 'The reply is polite and on topic.') $$, :'r_done', :'admin'),
  '10p. keeping a reply dismisses its report');
select throws_ok(format($$ select admin_moderate_review(%L, %L, 'reply', 'keep', null, 'Nothing left to dismiss here.') $$, :'r_done', :'admin'),
  '23514', null, '10q. ...and there''s nothing left to dismiss');
select lives_ok(format($$ select admin_moderate_review(%L, %L, 'reply', 'remove', 'abuse', 'Removing to test the reply email.') $$, :'r_done', :'admin'),
  '10r. an admin removes a reply');
select tests.clear_authentication();
select is((select count(*)::int from booking_emails where booking_id = :'b_done' and kind = 'provider_reply_removed'), 1, '10s. ...the provider is emailed');
select tests.authenticate_as(:'owner1');
update review_replies set body = 'Trying to bring the removed reply back.' where review_id = :'r_done';
select is((select status from review_replies where review_id = :'r_done'), 'removed', '10t. a removed reply can''t be edited back');
delete from review_replies where review_id = :'r_done';
select lives_ok(format($$ insert into review_replies (review_id, body) values (%L, 'Thank you for coming along, Sam.') $$, :'r_done'),
  '10u. ...it''s deleted and written again');
select tests.clear_authentication();
select is((select count(*)::int from admin_actions where target = 'review'), 4, '10v. every action logged (remove, restore, keep, remove reply)');

-- ---------------------------------------------------------------------------
-- 11. A booking cancelled after it was reviewed keeps its review
-- ---------------------------------------------------------------------------
update bookings set status = 'cancelled', status_changed_by = 'admin', cancelled_by = 'admin', cancelled_at = now(), refunded_cents = total_cents
  where id = :'b_paid';
set local role anon;
select is((select count(*)::int from reviews where id = :'r_paid'), 1, '11a. a later refund doesn''t hide an honest review');
reset role;
select is((select review_count from listing_ratings where listing_id = :'le1'), 4, '11b. ...and it still counts');

-- 12. A suspended provider's reviews and rating aren't public.
update providers set status = 'suspended' where id = :'p2';
set local role anon;
select is((select count(*)::int from reviews where id = :'r_quiet'), 0, '12a. a suspended provider''s reviews aren''t public');
select is((select count(*)::int from provider_ratings where provider_id = :'p2'), 0, '12b. ...nor their rating');
reset role;

select * from finish();
rollback;
