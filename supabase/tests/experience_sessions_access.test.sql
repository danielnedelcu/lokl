-- Access, time and status rules for Experience sessions. Every allowed case
-- is paired with the blocked case next to it.
begin;
\ir _helpers/users.psql
select plan(46);

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

-- A's Experience (draft), B's Experience (draft) and A's Service (draft).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'pa', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 150, :'o4w')
returning id as la \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'pb', 'experience', :'exp', :'atl', 'Mural walk', 'Street art of Old Fourth Ward, on foot.', 3000, 90, :'o4w')
returning id as lb \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pa', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'o4w')
returning id as ls \gset

-- Times used below.
select (date_trunc('hour', now()) + interval '7 days')::text as t1 \gset
select (date_trunc('hour', now()) + interval '8 days')::text as t2 \gset
select (date_trunc('hour', now()) + interval '9 days')::text as t3 \gset

-- Sessions made by the runner: one of A's that already happened, and a
-- future and a past one on B's listing.
insert into experience_sessions (listing_id, starts_at, capacity)
values (:'la', now() - interval '2 days', 10) returning id as past \gset
insert into experience_sessions (listing_id, starts_at, capacity)
values (:'lb', :'t1', 10) returning id as bs \gset
insert into experience_sessions (listing_id, starts_at, capacity)
values (:'lb', now() - interval '3 days', 10);

-- ---------------------------------------------------------------------------
-- ADDING SESSIONS
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 1. A provider can add a future session to their own Experience...
select lives_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 12) $$, :'la', :'t1'),
  '1a. a provider can add a session to their own Experience'
);
select is(
  (select status from experience_sessions where listing_id = :'la' and starts_at = :'t1'::timestamptz),
  'scheduled', '1b. a new session is scheduled'
);

-- 2. ...but not to another provider's.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 12) $$, :'lb', :'t2'),
  '42501', 'new row violates row-level security policy for table "experience_sessions"',
  '2. a provider cannot add a session to another provider''s Experience'
);

-- 3. Services don't have sessions.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 12) $$, :'ls', :'t1'),
  '23514', 'Only Experiences have sessions.',
  '3. a session cannot be attached to a Service'
);

-- 4. New sessions are in the future, and at most a year ahead.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, now() - interval '1 hour', 12) $$, :'la'),
  '23514', 'Choose a time in the future.',
  '4a. a provider cannot add a session in the past'
);
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, now() + interval '13 months', 12) $$, :'la'),
  '23514', 'Sessions can be added up to a year ahead.',
  '4b. a provider cannot add a session more than a year ahead'
);

-- 5. Capacity is 1 to 500.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 0) $$, :'la', :'t2'),
  '23514', 'new row for relation "experience_sessions" violates check constraint "experience_sessions_capacity_check"',
  '5a. a session needs at least 1 spot'
);
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 501) $$, :'la', :'t2'),
  '23514', 'new row for relation "experience_sessions" violates check constraint "experience_sessions_capacity_check"',
  '5b. a session has at most 500 spots'
);

-- 6. Two scheduled sessions can't start at the same time; the error names
-- the clashing date in the city's time zone.
select format('There''s already a session on %s.',
  to_char(:'t1'::timestamptz at time zone 'America/New_York', 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM')) as clash_t1 \gset
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 8) $$, :'la', :'t1'),
  '23505', :'clash_t1',
  '6. two scheduled sessions of one Experience cannot start at the same time'
);

-- 7. Status isn't set on insert: a provider can't add a cancelled session.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity, status) values (%L, %L, 8, 'cancelled') $$, :'la', :'t2'),
  '42501', 'permission denied for table experience_sessions',
  '7. a provider cannot choose the status of a new session'
);

-- ---------------------------------------------------------------------------
-- CHANGING SESSIONS
-- ---------------------------------------------------------------------------

select id as s1 from experience_sessions where listing_id = :'la' and starts_at = :'t1'::timestamptz \gset

-- 8. A provider can move a future session and change its spots...
select lives_ok(
  format($$ update experience_sessions set starts_at = %L, capacity = 20 where id = %L $$, :'t2', :'s1'),
  '8a. a provider can move a future session and change its spots'
);
select is((select capacity::int from experience_sessions where id = :'s1'), 20, '8b. ...and the change is saved');

-- 9. ...but not into the past, or more than a year ahead.
select throws_ok(
  format($$ update experience_sessions set starts_at = now() - interval '1 hour' where id = %L $$, :'s1'),
  '23514', 'Choose a time in the future.',
  '9a. a provider cannot move a session into the past'
);
select throws_ok(
  format($$ update experience_sessions set starts_at = now() + interval '13 months' where id = %L $$, :'s1'),
  '23514', 'Sessions can be added up to a year ahead.',
  '9b. a provider cannot move a session more than a year ahead'
);

-- 10. A session stays on its listing.
select throws_ok(
  format($$ update experience_sessions set listing_id = %L where id = %L $$, :'lb', :'s1'),
  '42501', 'permission denied for table experience_sessions',
  '10. a session cannot be moved to another listing'
);

-- 11. A session that has started can't be changed or deleted.
select throws_ok(
  format($$ update experience_sessions set capacity = 30 where id = %L $$, :'past'),
  '23514', 'This session has already started, so it can''t be changed.',
  '11a. a provider cannot change a session that has started'
);
select throws_ok(
  format($$ delete from experience_sessions where id = %L $$, :'past'),
  '23514', 'This session has already started, so it can''t be changed.',
  '11b. a provider cannot delete a session that has started'
);

-- 12. Another provider can't read, change or delete A's sessions.
select tests.authenticate_as(:'b');
select is((select count(*)::int from experience_sessions where listing_id = :'la'), 0,
  '12a. a provider cannot read another provider''s sessions');
with u as (update experience_sessions set capacity = 1 where id = :'s1' returning 1)
select is((select count(*)::int from u), 0, '12b. a provider cannot change another provider''s session');
with d as (delete from experience_sessions where id = :'s1' returning 1)
select is((select count(*)::int from d), 0, '12c. a provider cannot delete another provider''s session');

-- ---------------------------------------------------------------------------
-- CANCELLING AND DELETING
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 13. A provider can cancel a future session...
select lives_ok(
  format($$ update experience_sessions set status = 'cancelled' where id = %L $$, :'s1'),
  '13a. a provider can cancel a future session'
);
-- ...cancelling is final...
select throws_ok(
  format($$ update experience_sessions set status = 'scheduled' where id = %L $$, :'s1'),
  '23514', 'A cancelled session can''t be changed. Add a new session instead.',
  '13b. a cancelled session cannot be scheduled again'
);
-- ...and its time is free for a new session.
select lives_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 12) $$, :'la', :'t2'),
  '13c. a cancelled session''s time can be used again'
);

-- 14. A provider can delete a future session.
select lives_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 6) $$, :'la', :'t3'),
  '14a. setup: another future session'
);
with d as (delete from experience_sessions where listing_id = :'la' and starts_at = :'t3'::timestamptz returning 1)
select is((select count(*)::int from d), 1, '14b. a provider can delete a future session');

-- 15. A provider sees all their sessions: past, cancelled and scheduled.
select is((select count(*)::int from experience_sessions where listing_id = :'la'), 3,
  '15. a provider can read their own past and cancelled sessions');

-- ---------------------------------------------------------------------------
-- WHO SEES SESSIONS
-- ---------------------------------------------------------------------------

-- A's Experience goes live (as the server, with a photo).
select tests.clear_authentication();
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'la', :'pa' || '/' || :'la' || '/' || gen_random_uuid() || '.jpg', 0, 'Tacos on a picnic table');
update listings set status = 'live', published_at = now() where id = :'la';

select tests.authenticate_as_anon();

-- 16. Signed-out visitors see the future, scheduled sessions of a live Experience...
select is((select count(*)::int from experience_sessions where listing_id = :'la'), 1,
  '16a. a signed-out visitor sees only the future scheduled session of a live Experience');
select is((select count(*)::int from experience_sessions where id = :'s1'), 0,
  '16b. a signed-out visitor does not see a cancelled session');
select is((select count(*)::int from experience_sessions where id = :'past'), 0,
  '16c. a signed-out visitor does not see a past session');
-- ...but nothing of a draft.
select is((select count(*)::int from experience_sessions where listing_id = :'lb'), 0,
  '16d. a signed-out visitor does not see a draft Experience''s sessions');

-- 17. Signed-out visitors can't add sessions.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 5) $$, :'la', :'t3'),
  '42501', 'permission denied for table experience_sessions',
  '17. a signed-out visitor cannot add a session'
);

-- 18. Sessions hide with their listing when the provider is suspended.
select tests.clear_authentication();
update providers set status = 'suspended' where id = :'pa';
select tests.authenticate_as_anon();
select is((select count(*)::int from experience_sessions where listing_id = :'la'), 0,
  '18. a suspended provider''s sessions are hidden from the public');
select tests.clear_authentication();
update providers set status = 'active' where id = :'pa';

-- 19. A provider can add sessions to a live Experience.
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 6) $$, :'la', :'t3'),
  '19. a provider can add a session to a live Experience'
);

-- ---------------------------------------------------------------------------
-- STATUS LOCKS
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
update listings set status = 'submitted' where id = :'la';
select tests.authenticate_as(:'a');

-- 20. Sessions are locked while the Experience is in review...
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, now() + interval '10 days', 6) $$, :'la'),
  '23514', 'This listing''s sessions can''t be changed while it is submitted.',
  '20a. a provider cannot add a session while the Experience is submitted'
);
select throws_ok(
  format($$ update experience_sessions set capacity = 7 where listing_id = %L and starts_at = %L $$, :'la', :'t3'),
  '23514', 'This listing''s sessions can''t be changed while it is submitted.',
  '20b. a provider cannot change a session while the Experience is submitted'
);

-- 21. ...and while it's unpublished.
select tests.clear_authentication();
update listings set status = 'unpublished' where id = :'la';
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ delete from experience_sessions where listing_id = %L and starts_at = %L $$, :'la', :'t3'),
  '23514', 'This listing''s sessions can''t be changed while it is unpublished.',
  '21. a provider cannot delete a session while the Experience is unpublished'
);

-- 22. The server isn't limited by the locks.
select tests.authenticate_as_service_role();
select lives_ok(
  format($$ update experience_sessions set status = 'cancelled' where listing_id = %L and starts_at = %L $$, :'la', :'t3'),
  '22. the server can cancel a session of an unpublished Experience'
);

-- ---------------------------------------------------------------------------
-- WEEKLY SERIES ACROSS A CLOCK CHANGE
-- ---------------------------------------------------------------------------

-- US clocks go back on Sunday 3 November 2030. A 10:00 AM weekly series keeps
-- its local time: 14:00 UTC before the change, 15:00 UTC after. Fixed dates
-- far ahead, so the server (not bound by the year-ahead rule) adds them.
select tests.authenticate_as_service_role();
insert into experience_sessions (listing_id, starts_at, capacity) values
  (:'la', '2030-10-26 10:00 America/New_York', 10),
  (:'la', '2030-11-09 10:00 America/New_York', 10);

-- 25. The stored times are 10:00 AM Atlanta time on both sides of the change.
select is(
  (select array_agg(to_char(starts_at at time zone 'UTC', 'MM-DD HH24:MI') order by starts_at)
   from experience_sessions where listing_id = :'la' and starts_at > '2030-01-01'),
  array['10-26 14:00', '11-09 15:00'],
  '25. 10:00 AM Atlanta time is 14:00 UTC before the clock change and 15:00 UTC after'
);

-- 26. A series with one clashing week saves none of its sessions, and the
-- error names the clashing date in local time.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values
    (%1$L, '2030-10-19 10:00 America/New_York', 10),
    (%1$L, '2030-11-02 10:00 America/New_York', 10),
    (%1$L, '2030-11-09 10:00 America/New_York', 10),
    (%1$L, '2030-11-16 10:00 America/New_York', 10) $$, :'la'),
  '23505', 'There''s already a session on Saturday, November 9, 2030 at 10:00 AM.',
  '26a. a series clashing with an existing session fails, naming the clashing date'
);
select is(
  (select count(*)::int from experience_sessions where listing_id = :'la' and starts_at > '2030-01-01'), 2,
  '26b. ...and none of the series is saved'
);

-- 27. A series without clashes saves every week.
select lives_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values
    (%1$L, '2030-10-19 10:00 America/New_York', 10),
    (%1$L, '2030-11-02 10:00 America/New_York', 10),
    (%1$L, '2030-11-16 10:00 America/New_York', 10) $$, :'la'),
  '27a. a series without clashes is saved'
);
select is(
  (select count(*)::int from experience_sessions where listing_id = :'la' and starts_at > '2030-01-01'), 5,
  '27b. ...with every week'
);
-- Out of the way for the counts below.
delete from experience_sessions where listing_id = :'la' and starts_at > '2030-01-01';

-- ---------------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------------

select tests.authenticate_as_admin(:'admin');

-- 23. The admin can read every session...
select is((select count(*)::int from experience_sessions), 6, '23a. the admin can read every session');
-- ...but doesn't add them.
select throws_ok(
  format($$ insert into experience_sessions (listing_id, starts_at, capacity) values (%L, %L, 5) $$, :'lb', :'t2'),
  '42501', 'new row violates row-level security policy for table "experience_sessions"',
  '23b. the admin cannot add a session'
);

-- ---------------------------------------------------------------------------
-- DELETING A LISTING
-- ---------------------------------------------------------------------------

-- 24. Deleting a never-published Experience removes its sessions, past ones too.
select tests.authenticate_as(:'b');
select lives_ok(format($$ delete from listings where id = %L $$, :'lb'), '24a. a provider can delete their draft Experience');
select tests.clear_authentication();
select is((select count(*)::int from experience_sessions where listing_id = :'lb'), 0, '24b. its sessions go with it');

select * from finish();
rollback;
