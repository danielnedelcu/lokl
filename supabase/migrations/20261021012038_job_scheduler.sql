-- The job scheduler (decided 2026-10-21; docs/design/booking-and-checkout.md,
-- Jobs): Supabase's own scheduler (pg_cron) calls the website's job route
-- (pg_net) on a timetable, with the site's address and the job secret kept
-- in Vault. Switched off until hosting exists: with no Vault entries, as on
-- the local stack and in CI, every scheduled call does nothing.
--
-- 1. pg_cron and pg_net, which no API request can reach.
-- 2. job_status: one row per job, every run (started, finished, last
--    success, failures in a row, overlaps skipped). job_runs keeps only the
--    runs that did something, failed, left rows waiting or were killed.
-- 3. job_leases: one run of a job at a time. A run takes the lease, gives
--    it back at the end; a run that dies loses it after its limit, and the
--    next run records it as killed.
-- 4. The watchdog, inside the database (so it works when the website is
--    down): it alerts every owner, in the bell and by email (its own,
--    straight through Resend, plus the outbox's), when a job is
--    late, failing, or started and never finished; once per incident, and
--    again when it recovers (job_alerts, append-only).
-- 5. New jobs' database work: admin requests past 7 days expire (the
--    asker is told), and the owners are reminded, once, of hidden profile
--    content waiting 7 days.
-- 6. Money-moving Stripe calls use an idempotency key fixed per booking,
--    action and attempt (private.stripe_attempts): two calls at once send
--    the same key, so Stripe makes one transfer or refund; the attempt goes
--    up only after Stripe definitely refuses, so a later try isn't answered
--    with the old refusal (Stripe keeps a key's answer for 24 hours).
-- 7. The timetable itself.

-- ---------------------------------------------------------------------------
-- 1. THE EXTENSIONS
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Who can reach them: Supabase installs both owned by its own admin role,
-- which grants pg_net's functions to the API roles (and http_delete to
-- PUBLIC) and keeps the cron schema to itself and postgres. A migration
-- (run as postgres, not their grantor) can't revoke those grants, here or
-- on hosted. What keeps them out of reach: the API serves only the public,
-- graphql_public and private schemas (supabase/config.toml), so no request
-- can call net.* or cron.*; and no API role may use the cron schema at
-- all. job_scheduler.test.sql and job-route.test.mts check both. Only
-- lokl's own functions below, run by the timetable as postgres, call them.

-- ---------------------------------------------------------------------------
-- 2. JOB STATUS AND LEASES
-- ---------------------------------------------------------------------------

create table public.job_status (
  job text primary key check (char_length(job) <= 60),
  interval_seconds integer not null check (interval_seconds >= 60),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_outcome text check (last_outcome in ('ok', 'failed', 'skipped')),
  last_error text check (char_length(last_error) <= 500),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  skipped_overlaps integer not null default 0 check (skipped_overlaps >= 0),
  last_skipped_at timestamptz,
  killed_runs integer not null default 0 check (killed_runs >= 0),
  alerted_at timestamptz,
  alert_kind text check (alert_kind in ('late', 'failing', 'stuck'))
);
comment on table public.job_status is
  'One row per scheduled job: how often it should run, and how its latest runs went (every run, quiet ones included). The watchdog reads it. Written by job_start() and job_finish(); never deleted.';
comment on column public.job_status.interval_seconds is 'How often the timetable runs it. The watchdog calls it late after three intervals with no success.';
comment on column public.job_status.alerted_at is 'When the owners were alerted about the current incident (null: none open). Cleared, with a "recovered" alert, when it''s fixed.';
insert into public.job_status (job, interval_seconds) values
  ('send-emails', 60), ('release-reservations', 300), ('expire-requests', 300), ('withdraw-unavailable', 900),
  ('pay-out', 900), ('held-photos', 900), ('refresh-open-days', 3600), ('admin-requests', 3600),
  ('review-reminders', 86400), ('hidden-content-reminder', 86400);
alter table public.job_status enable row level security;
create policy job_status_read_admin on public.job_status for select to authenticated using ((select public.is_admin()));
comment on policy job_status_read_admin on public.job_status is 'The team reads how the jobs are doing (the dashboard''s Jobs card). Only the job functions write.';
grant select on public.job_status to authenticated;
create trigger job_status_refuse_delete before delete on public.job_status for each row execute function public.refuse_delete();

create table public.job_leases (
  job text primary key references public.job_status (job) on delete restrict,
  run_id uuid not null,
  started_at timestamptz not null,
  expires_at timestamptz not null
);
comment on table public.job_leases is
  'The run of each job going on now, if any: one at a time. Taken by job_start(), given back by job_finish(); a lease past expires_at belongs to a run that died. Server only.';
alter table public.job_leases enable row level security;
create policy job_leases_read_admin on public.job_leases for select to authenticated using ((select public.is_admin()));
comment on policy job_leases_read_admin on public.job_leases is 'The team can see which jobs are running now. Only job_start() and job_finish() write.';
grant select on public.job_leases to authenticated;

create function public.job_start(p_job text, p_lease_seconds integer default 300)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid := gen_random_uuid();
  v_old public.job_leases;
  v_got uuid;
begin
  if not exists (select 1 from public.job_status where job = p_job) then
    raise exception 'No such job.' using errcode = 'no_data_found';
  end if;
  select * into v_old from public.job_leases where job = p_job for update;
  insert into public.job_leases (job, run_id, started_at, expires_at)
  values (p_job, v_run, now(), now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 60)))
  on conflict (job) do update set run_id = excluded.run_id, started_at = excluded.started_at, expires_at = excluded.expires_at
    where public.job_leases.expires_at <= now()
  returning run_id into v_got;
  if v_got is null then
    -- Another run holds it: this one is skipped, not failed.
    update public.job_status set skipped_overlaps = skipped_overlaps + 1, last_skipped_at = now(), last_outcome = 'skipped'
     where job = p_job;
    return null;
  end if;
  -- Taken over from a run that never finished: the host stopped it, or it crashed.
  if v_old.run_id is not null then
    insert into public.job_runs (job, started_at, checked, changed, failed, error)
    values (p_job, v_old.started_at, 0, 0, 0,
            'This run started and never finished (stopped by the host, or it crashed). Rows it hadn''t reached wait for the next run.');
    update public.job_status set killed_runs = killed_runs + 1 where job = p_job;
  end if;
  update public.job_status set last_started_at = now() where job = p_job;
  return v_run;
end;
$$;
comment on function public.job_start(text, integer) is
  'Server only: starts a run of a job if no other run holds it (a lease for p_lease_seconds), returning the run''s id, or null (recorded as skipped). A lease left by a run that never finished is taken over and that run recorded as killed.';
revoke execute on function public.job_start(text, integer) from public, anon, authenticated;

create function public.job_finish(p_job text, p_run uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.job_leases where job = p_job and run_id = p_run;
  update public.job_status set
    last_finished_at = now(),
    last_success_at = case when p_ok then now() else last_success_at end,
    last_outcome = case when p_ok then 'ok' else 'failed' end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    consecutive_failures = case when p_ok then 0 else consecutive_failures + 1 end
  where job = p_job;
end;
$$;
comment on function public.job_finish(text, uuid, boolean, text) is
  'Server only: ends a run (gives its lease back) and records how it went in job_status. The error text is already cleaned (logText).';
revoke execute on function public.job_finish(text, uuid, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE WATCHDOG AND ITS ALERTS
-- ---------------------------------------------------------------------------

create table public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  job text not null references public.job_status (job) on delete restrict,
  kind text not null check (kind in ('late', 'failing', 'stuck', 'recovered')),
  message text not null check (char_length(message) <= 500),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.job_alerts is 'What the watchdog told the owners about a job: late, failing, stuck (started and never finished), or recovered. Append-only.';
create index job_alerts_recent on public.job_alerts (created_at desc);
alter table public.job_alerts enable row level security;
create policy job_alerts_read_admin on public.job_alerts for select to authenticated using ((select public.is_admin()));
comment on policy job_alerts_read_admin on public.job_alerts is 'The team reads the job alerts (the bell names them).';
grant select on public.job_alerts to authenticated;
create trigger job_alerts_append_only before update or delete on public.job_alerts
  for each row execute function public.append_only_guard();
create trigger job_alerts_append_only_truncate before truncate on public.job_alerts
  for each statement execute function public.append_only_guard();

-- The watchdog's own email: straight to Resend from the database (pg_net),
-- so an alert arrives even when the website (or its send-emails job) is
-- what's broken. Its Resend key and sender address are in Vault
-- (lokl_resend_key, lokl_alert_from); without them it sends nothing. The
-- outbox copy below still goes, unless this one was delivered.
alter table public.job_alerts add column direct_request_id bigint;
comment on column public.job_alerts.direct_request_id is 'The pg_net request that emailed the owners directly through Resend (null: not set up, or no owners).';

create function public.job_alert_send_direct(p_alert uuid, p_job text, p_kind text, p_message text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_from text;
  v_to text[];
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'lokl_resend_key';
  select decrypted_secret into v_from from vault.decrypted_secrets where name = 'lokl_alert_from';
  select array_agg(u.email order by u.email) into v_to
    from public.admin_members m join auth.users u on u.id = m.user_id
   where m.status = 'active' and m.role = 'owner' and u.email is not null;
  if v_key is null or v_from is null or v_to is null then
    return null;
  end if;
  return net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object(
      'from', v_from,
      'to', to_jsonb(v_to),
      'subject', case when p_kind = 'recovered' then format('lokl: %s is running again', p_job) else format('lokl: %s needs a look', p_job) end,
      'text', p_message || E'\n\nThe admin app''s dashboard has the details. This email comes straight from the database, so it arrives even if the website is down.'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'Idempotency-Key', 'job-alert-' || p_alert),
    timeout_milliseconds := 10000);
end;
$$;
comment on function public.job_alert_send_direct(uuid, text, text, text) is
  'The watchdog''s own email: sends a job alert to every active owner straight through Resend''s API (pg_net), with the key and sender from Vault. Returns the request''s id, or null when not set up (or no owners).';
revoke execute on function public.job_alert_send_direct(uuid, text, text, text) from public, anon, authenticated, service_role;

-- Whether the direct email went: sent (Resend said yes), failed, pending
-- (no answer yet), or none (not sent directly). The outbox copy goes
-- unless it was sent.
create function public.job_alert_delivery(p_alert uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.direct_request_id is null then 'none'
    when r.id is null then case when a.created_at > now() - interval '10 minutes' then 'pending' else 'failed' end
    when r.status_code between 200 and 299 then 'sent'
    else 'failed'
  end
  from public.job_alerts a left join net._http_response r on r.id = a.direct_request_id
  where a.id = p_alert;
$$;
comment on function public.job_alert_delivery(uuid) is
  'Server only (the owners'' outbox): how the watchdog''s direct email went: sent, failed, pending (no answer yet, for up to 10 minutes) or none.';
revoke execute on function public.job_alert_delivery(uuid) from public, anon, authenticated;

-- The bell and the owners' inbox: job alerts, and hidden content waiting 7 days.
alter table public.admin_notifications add column job_alert_id uuid references public.job_alerts (id) on delete restrict;
alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check check (kind in (
  'support_new', 'support_safety', 'support_reply', 'team_change', 'request_new', 'request_decided', 'limit_reached', 'support_refund',
  'listing_taken_down', 'settings_change', 'profile_hidden', 'profile_hidden_overdue', 'job_alert'));
alter table public.admin_notifications drop constraint admin_notifications_about_check;
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  num_nonnulls(report_id, admin_action_id, admin_request_id, job_alert_id) = 1
  and (kind in ('support_new', 'support_safety', 'support_reply')) = (report_id is not null)
  and (kind in ('team_change', 'limit_reached', 'support_refund', 'listing_taken_down', 'settings_change', 'profile_hidden', 'profile_hidden_overdue')) = (admin_action_id is not null)
  and (kind in ('request_new', 'request_decided')) = (admin_request_id is not null)
  and (kind = 'job_alert') = (job_alert_id is not null));
comment on column public.admin_notifications.job_alert_id is 'For a job alert: what the watchdog found.';

alter table public.admin_emails alter column admin_action_id drop not null;
alter table public.admin_emails add column job_alert_id uuid references public.job_alerts (id) on delete restrict;
alter table public.admin_emails add constraint admin_emails_about_check check (num_nonnulls(admin_action_id, job_alert_id) = 1);
alter table public.admin_emails drop constraint admin_emails_kind_check;
alter table public.admin_emails add constraint admin_emails_kind_check check (kind in (
  'admin_invite', 'admin_team_change', 'admin_request_new', 'admin_limit_reached', 'admin_support_refund',
  'admin_listing_taken_down', 'admin_settings_change', 'admin_profile_hidden', 'admin_profile_hidden_overdue', 'admin_job_alert'));
alter table public.admin_emails add constraint admin_emails_job_alert_kind check ((kind = 'admin_job_alert') = (job_alert_id is not null));
comment on column public.admin_emails.job_alert_id is 'For a job alert email: what the watchdog found (admin_action_id is empty then).';

-- Whether this environment's scheduler is set up (Vault has the job
-- secret), and since when. Null: switched off.
create function public.job_scheduler_configured_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(s.created_at) from vault.secrets s where s.name in ('lokl_site_url', 'lokl_job_secret')
   having count(distinct s.name) = 2;
$$;
comment on function public.job_scheduler_configured_at() is
  'When this environment''s scheduler was set up (both Vault entries, lokl_site_url and lokl_job_secret, exist), or null when it''s switched off.';
revoke execute on function public.job_scheduler_configured_at() from public, anon, authenticated, service_role;

create function public.job_watchdog(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := public.job_scheduler_configured_at();
  s public.job_status;
  v_lease public.job_leases;
  v_kind text;
  v_message text;
  v_alert uuid;
  v_sent integer := 0;
begin
  -- Switched off (no scheduler set up): nothing is expected to run.
  if v_since is null then
    return 0;
  end if;
  for s in select * from public.job_status order by job for update loop
    select * into v_lease from public.job_leases where job = s.job;
    v_kind := case
      when v_lease.job is not null and v_lease.expires_at < p_now - interval '1 minute' then 'stuck'
      when s.consecutive_failures >= 3 then 'failing'
      when greatest(coalesce(s.last_success_at, '-infinity'), v_since) < p_now - make_interval(secs => 3 * s.interval_seconds) then 'late'
    end;
    if v_kind is not null and s.alerted_at is null then
      v_message := case v_kind
        when 'stuck' then format('%s started at %s and never finished.', s.job, to_char(v_lease.started_at at time zone 'America/New_York', 'Mon DD, HH12:MI AM'))
        when 'failing' then format('%s has failed %s times in a row.', s.job, s.consecutive_failures)
        else format('%s hasn''t run successfully since %s.', s.job,
                    coalesce(to_char(s.last_success_at at time zone 'America/New_York', 'Mon DD, HH12:MI AM'), 'the scheduler was set up'))
      end || ' (Atlanta time)';
    elsif v_kind is null and s.alerted_at is not null then
      v_message := format('%s is running normally again.', s.job);
    else
      continue;
    end if;
    v_alert := gen_random_uuid();
    insert into public.job_alerts (id, job, kind, message, direct_request_id)
    values (v_alert, s.job, coalesce(v_kind, 'recovered'), v_message,
            public.job_alert_send_direct(v_alert, s.job, coalesce(v_kind, 'recovered'), v_message));
    insert into public.admin_notifications (recipient_id, kind, job_alert_id)
    select m.user_id, 'job_alert', v_alert from public.admin_members m where m.status = 'active' and m.role = 'owner';
    insert into public.admin_emails (kind, job_alert_id, recipient_id)
    select 'admin_job_alert', v_alert, m.user_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
    update public.job_status set alerted_at = case when v_kind is null then null else p_now end, alert_kind = v_kind where job = s.job;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
comment on function public.job_watchdog(timestamptz) is
  'Run by the timetable every 10 minutes, inside the database, at the database''s time (p_now is for tests, as in queue_review_reminders): alerts every owner (bell, the outbox, and an email sent straight through Resend so it arrives even if the website is down) when a job is stuck (started, never finished), failing (3 in a row) or late (no success within 3 intervals), once per incident, and again when it recovers. Does nothing while the scheduler is switched off.';
revoke execute on function public.job_watchdog(timestamptz) from public, anon, authenticated, service_role;

-- admin_dashboard: from 20261017053502_support_reports.sql. Its job-runs
-- count now matches the Bookings page's list: runs that failed, errored or
-- left rows waiting.
CREATE OR REPLACE FUNCTION public.admin_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tz text := coalesce((select timezone from public.cities where slug = 'atlanta'), 'America/New_York');
  v_today date := (now() at time zone v_tz)::date;
  v_from30 date := v_today - 29;
  v_from90 date := v_today - 89;
  v_paid jsonb;
  v_attention jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;

  -- The money cards: the Bookings page's totals for "paid in the last 30 days".
  v_paid := public.admin_bookings_page(p_paid_from => v_from30, p_paid_to => v_today, p_page_size => 1, p_with_attention => true);
  v_attention := v_paid -> 'attention';

  return jsonb_build_object(
    'time_zone', v_tz,
    'today', v_today,
    'paid_from', v_from30,
    'active_since', v_from90,
    'gmv_cents', (v_paid -> 'totals' ->> 'charged_cents')::bigint - (v_paid -> 'totals' ->> 'refunded_cents')::bigint,
    'commission_cents', (v_paid -> 'totals' ->> 'commission_cents')::bigint,
    'bookings', (v_paid ->> 'total')::bigint,
    'active_providers', (public.admin_providers_page(p_paid_since => v_from90, p_page_size => 1) ->> 'total')::bigint,
    'listings_to_review', jsonb_build_object(
      'experience', (public.admin_listings_page(p_kind => 'experience', p_status => 'submitted', p_page_size => 1) ->> 'total')::bigint,
      'service', (public.admin_listings_page(p_kind => 'service', p_status => 'submitted', p_page_size => 1) ->> 'total')::bigint),
    'open_disputes', (select count(*) from public.booking_finances f where f.disputed_at is not null and f.dispute_closed_at is null),
    -- As the Bookings page's "Needs attention" heading counts: its groups,
    -- failed emails, and job runs with failures in the last 7 days.
    'bookings_attention',
      (select coalesce(sum(value::bigint), 0) from jsonb_each_text(coalesce(v_attention, '{}'::jsonb)))
      + (select count(*) from public.booking_emails e where e.status = 'failed')
      + (select count(*) from public.job_runs r where r.finished_at >= now() - interval '7 days' and (r.failed > 0 or r.error is not null or r.more_waiting)),
    -- As the Guides list's "Draft" tab counts them: every guide not live.
    'guide_drafts', (select count(*) from public.guides g where g.status <> 'published'),
    'providers_not_payable', (public.admin_providers_page(p_status => 'active', p_payout_setup => 'not_ready', p_page_size => 1) ->> 'total')::bigint,
    -- Problem reports not yet done, and how many of those are Safety.
    'open_reports', (select count(*) from public.support_reports r where r.status <> 'done'),
    'urgent_reports', (select count(*) from public.support_reports r where r.status <> 'done' and r.urgent)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. NEW JOBS' DATABASE WORK
-- ---------------------------------------------------------------------------

-- admin-requests: until now a request past 7 days only expired when
-- someone next opened one; now on the hour, and the asker is told.
create function public.admin_requests_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  with gone as (
    update public.admin_requests set status = 'expired', decided_at = now(), result = 'Not decided within 7 days.'
     where status = 'pending' and created_at <= now() - interval '7 days'
    returning id
  ) select coalesce(array_agg(id), '{}') into v_ids from gone;
  foreach v_id in array v_ids loop
    perform public.admin_request_tell_asker(v_id);
  end loop;
  return jsonb_build_object('expired', to_jsonb(v_ids));
end;
$$;
comment on function public.admin_requests_sweep() is 'Server only (the admin-requests job): expires requests the owner hasn''t decided within 7 days, and tells each asker.';
revoke execute on function public.admin_requests_sweep() from public, anon, authenticated;

-- hidden-content-reminder: every owner, once per hide, when its content has
-- waited 7 days (it stays hidden; nothing is deleted).
alter table public.provider_profile_holds add column reminded_at timestamptz;
comment on column public.provider_profile_holds.reminded_at is 'When the owners were reminded that it has waited 7 days (once).';
create function public.profile_holds_remind()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action uuid;
  v_sent uuid[] := '{}';
begin
  for v_action in
    select distinct h.hidden_action_id from public.provider_profile_holds h
     where h.status = 'hidden' and h.reminded_at is null and h.hidden_at <= now() - interval '7 days'
  loop
    perform public.admin_alert_owners(v_action, 'profile_hidden_overdue', 'admin_profile_hidden_overdue');
    update public.provider_profile_holds set reminded_at = now()
     where hidden_action_id = v_action and status = 'hidden' and reminded_at is null;
    v_sent := v_sent || v_action;
  end loop;
  return jsonb_build_object('reminded', to_jsonb(v_sent));
end;
$$;
comment on function public.profile_holds_remind() is
  'Server only (the hidden-content-reminder job): reminds every owner, once per hide, of hidden profile content waiting 7 days. It stays hidden.';
revoke execute on function public.profile_holds_remind() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. STRIPE ATTEMPTS: ONE KEY PER BOOKING, ACTION AND ATTEMPT
-- ---------------------------------------------------------------------------

create table private.stripe_attempts (
  booking_id uuid not null references public.bookings (id) on delete restrict,
  action text not null check (action in ('transfer', 'refund', 'reversal', 'capture')),
  attempt integer not null default 1 check (attempt >= 1),
  raised_at timestamptz,
  primary key (booking_id, action)
);
comment on table private.stripe_attempts is
  'The attempt number in each money-moving Stripe call''s idempotency key (booking:<id>:<action>:...:<attempt>). Raised only after Stripe definitely refused that attempt, so two calls at once share a key (Stripe acts once) and a later try isn''t answered with the stored refusal. Server only; never deleted.';
alter table private.stripe_attempts enable row level security;
create policy stripe_attempts_server_only on private.stripe_attempts for select to service_role using (true);
comment on policy stripe_attempts_server_only on private.stripe_attempts is 'The website''s server only (the private schema is never granted to visitors or signed-in users). Written by stripe_attempt() and stripe_refused().';
revoke all on private.stripe_attempts from public, anon, authenticated;
grant select on private.stripe_attempts to service_role;
create trigger stripe_attempts_refuse_delete before delete on private.stripe_attempts for each row execute function public.refuse_delete();

create function private.stripe_attempt(p_booking_id uuid, p_action text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  insert into private.stripe_attempts (booking_id, action) values (p_booking_id, p_action) on conflict do nothing;
  select attempt into v_attempt from private.stripe_attempts where booking_id = p_booking_id and action = p_action;
  return v_attempt;
end;
$$;
comment on function private.stripe_attempt(uuid, text) is 'Server only: the current attempt number for a booking''s money-moving action (1 the first time).';
revoke execute on function private.stripe_attempt(uuid, text) from public, anon, authenticated;
grant execute on function private.stripe_attempt(uuid, text) to service_role;

create function private.stripe_refused(p_booking_id uuid, p_action text, p_attempt integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  -- Only the attempt Stripe refused moves on: two refusals of the same
  -- attempt (two calls at once) raise it once.
  update private.stripe_attempts set attempt = attempt + 1, raised_at = now()
   where booking_id = p_booking_id and action = p_action and attempt = p_attempt;
  select attempt into v_attempt from private.stripe_attempts where booking_id = p_booking_id and action = p_action;
  return v_attempt;
end;
$$;
comment on function private.stripe_refused(uuid, text, integer) is 'Server only: after Stripe definitely refused attempt p_attempt, the next try uses a new key (once, however many calls saw the refusal).';
revoke execute on function private.stripe_refused(uuid, text, integer) from public, anon, authenticated;
grant execute on function private.stripe_refused(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. THE CALL AND THE TIMETABLE
-- ---------------------------------------------------------------------------

-- Calls one job on this environment's website, with its secret, from Vault.
-- Switched off (returns null, calls nothing) until both Vault entries exist.
create function public.run_scheduled_job(p_job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'lokl_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lokl_job_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/api/jobs/' || p_job,
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-job-secret', v_secret, 'content-type', 'application/json'),
    timeout_milliseconds := 120000);
end;
$$;
comment on function public.run_scheduled_job(text) is
  'The timetable''s call: POSTs to <lokl_site_url>/api/jobs/<job> with the job secret, both from Vault. Does nothing (returns null) while either is missing: the scheduler is switched off until hosting exists.';
revoke execute on function public.run_scheduled_job(text) from public, anon, authenticated, service_role;

-- Times are UTC: 14:00 is 10 AM in Atlanta in summer, 9 AM in winter.
select cron.schedule('lokl-send-emails', '* * * * *', $$select public.run_scheduled_job('send-emails')$$);
select cron.schedule('lokl-release-reservations', '*/5 * * * *', $$select public.run_scheduled_job('release-reservations')$$);
select cron.schedule('lokl-expire-requests', '1-59/5 * * * *', $$select public.run_scheduled_job('expire-requests')$$);
select cron.schedule('lokl-withdraw-unavailable', '2-59/15 * * * *', $$select public.run_scheduled_job('withdraw-unavailable')$$);
select cron.schedule('lokl-pay-out', '7-59/15 * * * *', $$select public.run_scheduled_job('pay-out')$$);
select cron.schedule('lokl-held-photos', '11-59/15 * * * *', $$select public.run_scheduled_job('held-photos')$$);
select cron.schedule('lokl-refresh-open-days', '23 * * * *', $$select public.run_scheduled_job('refresh-open-days')$$);
select cron.schedule('lokl-admin-requests', '41 * * * *', $$select public.run_scheduled_job('admin-requests')$$);
select cron.schedule('lokl-review-reminders', '0 14 * * *', $$select public.run_scheduled_job('review-reminders')$$);
select cron.schedule('lokl-hidden-content-reminder', '0 13 * * *', $$select public.run_scheduled_job('hidden-content-reminder')$$);
select cron.schedule('lokl-watchdog', '*/10 * * * *', $$select public.job_watchdog()$$);
