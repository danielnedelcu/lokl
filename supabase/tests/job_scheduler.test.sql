-- The job scheduler (migration job_scheduler): the timetable and its call
-- (switched off without Vault), leases, job status, the watchdog's alerts,
-- the new jobs' database work, and the money-moving calls' attempt numbers.
begin;
\ir _helpers/users.psql
select plan(65);

select tests.create_user('js-owner@test.local') as owner \gset
select tests.create_user('js-owner2@test.local') as owner2 \gset
select tests.create_user('js-support@test.local') as sup \gset
select tests.create_user('js-provider@test.local') as powner \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup');

-- ---------------------------------------------------------------------------
-- 1. THE TIMETABLE, AND WHO CAN REACH THE EXTENSIONS
-- ---------------------------------------------------------------------------

select is((select string_agg(jobname || ' ' || schedule, ', ' order by jobname) from cron.job where jobname like 'lokl-%'),
  'lokl-admin-requests 41 * * * *, lokl-expire-requests 1-59/5 * * * *, lokl-held-photos 11-59/15 * * * *, lokl-hidden-content-reminder 0 13 * * *, '
  || 'lokl-pay-out 7-59/15 * * * *, lokl-refresh-open-days 23 * * * *, lokl-release-reservations */5 * * * *, lokl-review-reminders 0 14 * * *, '
  || 'lokl-send-emails * * * * *, lokl-watchdog */10 * * * *, lokl-withdraw-unavailable 2-59/15 * * * *',
  '1a. every job is on the timetable, at its interval');
select is((select count(*)::int from cron.job where jobname like 'lokl-%' and jobname <> 'lokl-watchdog'
             and command = format('select public.run_scheduled_job(%L)', substr(jobname, 6))), 10, '1b. ...each calling its own job by name');
select is((select string_agg(job, ',' order by job) from job_status), 'admin-requests,expire-requests,held-photos,hidden-content-reminder,pay-out,'
  || 'refresh-open-days,release-reservations,review-reminders,send-emails,withdraw-unavailable', '1c. each job has a status row');
select is((select string_agg(r, ',' order by r) from (values ('anon'), ('authenticated'), ('service_role')) v(r) where has_schema_privilege(r, 'cron', 'usage')),
  null, '1d. no API role may use the cron schema');

-- Switched off: no Vault entries, so the call does nothing.
select is((select count(*)::int from vault.secrets where name in ('lokl_site_url', 'lokl_job_secret')), 0, '1e. (no scheduler set up here)');
select is(run_scheduled_job('send-emails'), null::bigint, '1f. switched off, a scheduled call sends nothing');
select is(job_watchdog(), 0, '1g. ...and the watchdog alerts no one');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok($$ select run_scheduled_job('send-emails') $$, '42501', NULL, '1h. nobody signed in can make the database call a job');
select tests.authenticate_as_service_role();
select throws_ok($$ select run_scheduled_job('send-emails') $$, '42501', NULL, '1i. ...nor the server key');
select throws_ok($$ select job_watchdog() $$, '42501', NULL, '1j. ...or run the watchdog');
select tests.clear_authentication();

-- Set up: the call goes to this environment's website, with the secret.
select vault.create_secret('https://staging.example.test/', 'lokl_site_url');
select vault.create_secret('test-job-secret', 'lokl_job_secret');
select isnt(run_scheduled_job('pay-out'), null::bigint, '1k. set up, the call is queued');
select is((select url || '|' || (headers ->> 'x-job-secret') || '|' || method from net.http_request_queue order by id desc limit 1),
  'https://staging.example.test/api/jobs/pay-out|test-job-secret|POST', '1l. ...a POST to the job''s route, with the secret');

-- ---------------------------------------------------------------------------
-- 2. LEASES AND STATUS
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select job_start('pay-out') as run1 \gset
select isnt(:'run1'::uuid, null::uuid, '2a. a run starts');
select is(job_start('pay-out'), null::uuid, '2b. a second run while it''s going is skipped');
select is((select last_outcome || '|' || skipped_overlaps from job_status where job = 'pay-out'), 'skipped|1', '2c. ...and recorded as skipped, not failed');
select lives_ok(format($$ select job_finish('pay-out', %L, true) $$, :'run1'), '2d. the run finishes');
select is((select last_outcome || '|' || consecutive_failures || '|' || (last_success_at is not null)::text from job_status where job = 'pay-out'),
  'ok|0|true', '2e. ...recorded as a success');
select is((select count(*)::int from job_leases where job = 'pay-out'), 0, '2f. ...and its lease given back');
select job_start('pay-out') as run2 \gset
select lives_ok(format($$ select job_finish('pay-out', %L, false, 'Stripe timed out') $$, :'run2'), '2g. a run fails');
select is((select last_outcome || '|' || consecutive_failures || '|' || last_error from job_status where job = 'pay-out'),
  'failed|1|Stripe timed out', '2h. ...recorded, with its cleaned error');
select throws_ok($$ select job_start('no-such-job') $$, 'P0002', 'No such job.', '2i. only jobs on the list');
-- A run the host stopped: its lease outlives it, and the next run takes it over.
select job_start('send-emails') as run3 \gset
select tests.clear_authentication();
update job_leases set expires_at = now() - interval '1 second', started_at = now() - interval '6 minutes' where job = 'send-emails';
select tests.authenticate_as_service_role();
select isnt(job_start('send-emails'), null::uuid, '2j. the next run takes over a lease left by a run that died');
select tests.clear_authentication();
select is((select killed_runs from job_status where job = 'send-emails'), 1, '2k. ...counting it as killed');
select is((select count(*)::int from job_runs where job = 'send-emails' and error like 'This run started and never finished%'), 1, '2l. ...with a record of it in job_runs');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok($$ select job_start('send-emails') $$, '42501', NULL, '2m. nobody signed in can start a job');
select is((select count(*)::int from job_status), 10, '2n. the team can read how the jobs are doing');
select tests.authenticate_as(:'powner');
select is((select count(*)::int from job_status), 0, '2o. ...nobody else can');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 3. THE WATCHDOG
-- ---------------------------------------------------------------------------

-- The watchdog takes the time (as queue_review_reminders does), so later
-- moments are tried by passing them; the timetable passes nothing.
update job_status set last_success_at = now() where job <> 'pay-out';
update job_status set last_success_at = now() - interval '2 hours', consecutive_failures = 3 where job = 'pay-out';
delete from job_leases;
select is(job_watchdog(), 1, '3a. one job in trouble: one alert');
select is((select kind || '|' || message from job_alerts order by created_at desc limit 1), 'failing|pay-out has failed 3 times in a row. (Atlanta time)',
  '3b. ...that it''s failing, in words');
select is((select count(*)::int from admin_notifications where kind = 'job_alert' and recipient_id in (:'owner', :'owner2')), 2, '3c. ...in every owner''s bell');
select is((select count(*)::int from admin_emails where kind = 'admin_job_alert'), 2, '3d. ...and inbox');
select is((select count(*)::int from admin_notifications where kind = 'job_alert' and recipient_id = :'sup'), 0, '3e. ...not support''s');
select is(job_watchdog(), 0, '3f. once per incident');
update job_status set consecutive_failures = 0, last_success_at = now() where job = 'pay-out';
select is(job_watchdog(), 1, '3g. recovered: one more alert');
select is((select kind || '|' || message from job_alerts order by created_at desc limit 1), 'recovered|pay-out is running normally again.', '3h. ...saying so');
-- Late: no success within three intervals.
select is(job_watchdog(now() + interval '4 minutes'), 1, '3i. four minutes on, a job due every minute with no success is late');
select is((select kind from job_alerts order by created_at desc limit 1), 'late', '3j. ...and the alert says so');
update job_status set last_success_at = now(), alerted_at = null, alert_kind = null where job = 'send-emails';
-- Stuck: started and never finished, and nothing took it over.
insert into job_leases (job, run_id, started_at, expires_at) values ('held-photos', gen_random_uuid(), now() - interval '10 minutes', now() - interval '5 minutes');
select is(job_watchdog(), 1, '3k. a run that started and never finished is stuck');
select is((select kind from job_alerts order by created_at desc limit 1), 'stuck', '3l. ...and the alert says so');
select throws_ok($$ update job_alerts set message = 'edited' $$, '23514', NULL, '3m. the alerts are append-only');

-- The watchdog's own email, straight to Resend (so it arrives if the website is down).
select is((select count(*)::int from job_alerts where direct_request_id is not null), 0, '3m2. without the Resend key in Vault, no direct email is sent');
select is((select count(*)::int from net.http_request_queue where url = 'https://api.resend.com/emails'), 0, '3m3. ...nothing queued to Resend');
select vault.create_secret('re_test_key', 'lokl_resend_key');
select vault.create_secret('lokl <alerts@example.test>', 'lokl_alert_from');
update job_status set consecutive_failures = 3 where job = 'review-reminders';
select is(job_watchdog(), 1, '3m4. set up, the next alert...');
select id as alert, direct_request_id as req from job_alerts order by created_at desc limit 1 \gset
select is((select (headers ->> 'Authorization') || '|' || (headers ->> 'Idempotency-Key') || '|' || (convert_from(body, 'utf8')::jsonb ->> 'from') || '|' || (convert_from(body, 'utf8')::jsonb -> 'to')::text
             from net.http_request_queue where id = :req),
  'Bearer re_test_key|job-alert-' || :'alert' || '|lokl <alerts@example.test>|["js-owner@test.local", "js-owner2@test.local"]',
  '3m5. ...is emailed straight through Resend to every owner, once (its own idempotency key)');
select tests.authenticate_as_service_role();
select is(job_alert_delivery(:'alert'), 'pending', '3m6. before Resend answers: pending (the outbox waits)');
select tests.clear_authentication();
insert into net._http_response (id, status_code, created) values (:req, 200, now());
select tests.authenticate_as_service_role();
select is(job_alert_delivery(:'alert'), 'sent', '3m7. Resend said yes: sent (the outbox copy is skipped)');
select tests.clear_authentication();
update job_status set consecutive_failures = 0, last_success_at = now() where job = 'review-reminders';
select is(job_watchdog(), 1, '3m8. the recovery is emailed too');
select id as alert2, direct_request_id as req2 from job_alerts order by created_at desc limit 1 \gset
insert into net._http_response (id, status_code, created) values (:req2, 422, now());
select tests.authenticate_as_service_role();
select is(job_alert_delivery(:'alert2'), 'failed', '3m9. Resend said no: failed (the outbox copy goes)');
select is(job_alert_delivery((select id from job_alerts where direct_request_id is null limit 1)), 'none', '3m10. an alert not sent directly: none');
select tests.clear_authentication();
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select job_alert_delivery(%L) $$, :'alert'), '42501', NULL, '3m11. nobody signed in reads how it went');
select tests.clear_authentication();
select throws_ok($$ insert into admin_emails (kind, recipient_id) values ('admin_job_alert', gen_random_uuid()) $$, '23514', NULL,
  '3n. a job alert email names its alert');

-- ---------------------------------------------------------------------------
-- 4. THE NEW JOBS' DATABASE WORK
-- ---------------------------------------------------------------------------

select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id, headline) values (:'powner', 'JS Tours', :'atl', 'Walks with stories') returning id as p \gset
-- A support request the owner never decided, 8 days old.
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select admin_request_create('suspend_provider', null, :'p', 'Three no-shows this month.', null, false) as req \gset
select tests.clear_authentication();
set local session_replication_role = replica;
update admin_requests set created_at = now() - interval '8 days' where id = :'req';
set local session_replication_role = origin;
select tests.authenticate_as_service_role();
select is(admin_requests_sweep() -> 'expired' ->> 0, :'req', '4a. the admin-requests job expires a request past 7 days');
select tests.clear_authentication();
select is((select status from admin_requests where id = :'req'), 'expired', '4b. ...recorded');
select is((select count(*)::int from admin_notifications where kind = 'request_decided' and admin_request_id = :'req' and recipient_id = :'sup'), 1,
  '4c. ...and the asker is told');
-- Hidden profile content waiting 8 days.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select admin_hide_profile_content(:'sup', :'p', array['headline'], 'abuse', 'Insults a competitor by name.');
select tests.clear_authentication();
set local session_replication_role = replica;
update provider_profile_holds set hidden_at = now() - interval '8 days' where provider_id = :'p';
set local session_replication_role = origin;
select tests.authenticate_as_service_role();
select is(jsonb_array_length(profile_holds_remind() -> 'reminded'), 1, '4d. the reminder job finds the hide waiting 7 days');
select is(jsonb_array_length(profile_holds_remind() -> 'reminded'), 0, '4e. ...and reminds once');
select tests.clear_authentication();
select is((select count(*)::int from admin_notifications where kind = 'profile_hidden_overdue' and recipient_id in (:'owner', :'owner2')), 2,
  '4f. every owner''s bell');
select is((select count(*)::int from admin_emails where kind = 'admin_profile_hidden_overdue'), 2, '4g. ...and inbox');
select is((select status from provider_profile_holds where provider_id = :'p'), 'hidden', '4h. it stays hidden: nothing is deleted');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok($$ select admin_requests_sweep() $$, '42501', NULL, '4i. nobody signed in runs the jobs'' database work');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 5. MONEY-MOVING CALLS: ONE KEY PER BOOKING, ACTION AND ATTEMPT
-- ---------------------------------------------------------------------------

-- A booking (the attempts belong to one).
select tests.create_user('js-customer@test.local') as cust \gset
insert into categories (kind, name, slug) values ('experience', 'JS walks', 'js-walks') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'JS Ward') returning id as area \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'cat', :'atl', 'JS walk', 'A walk made for the scheduler test, long enough.', 4000, 60, :'area') returning id as l \gset
select tests.make_ready(:'l');
update listings set status = 'submitted' where id = :'l';
update listings set status = 'live', published_at = now() where id = :'l';
insert into experience_sessions (listing_id, starts_at, capacity) values (:'l', now() + interval '5 days', 4) returning id as s1 \gset
select tests.authenticate_as_service_role();
select (reserve_experience_booking(:'s1', :'cust', 1::smallint, 'Sam Customer', 'sam@test.local', null, null, now() + interval '30 minutes')).id as b \gset
select tests.authenticate_as_service_role();
select is(private.stripe_attempt(:'b', 'transfer'), 1, '5a. a booking''s first transfer is attempt 1');
select is(private.stripe_attempt(:'b', 'transfer'), 1, '5b. ...and stays 1 for every call (two runs at once share the key)');
select is(private.stripe_refused(:'b', 'transfer', 1), 2, '5c. Stripe definitely refused attempt 1: the next try is attempt 2');
select is(private.stripe_refused(:'b', 'transfer', 1), 2, '5d. ...a second report of the same refusal raises it once');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok(format($$ select private.stripe_attempt(%L, 'refund') $$, :'b'), '42501', NULL, '5e. nobody signed in reaches the attempts');
select tests.clear_authentication();

select * from finish();
rollback;
