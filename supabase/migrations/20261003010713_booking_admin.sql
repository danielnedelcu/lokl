-- Step 4, part 8: the admin side of bookings.
--
-- 1. Resolving a no-show report: in the provider's favour (their payout can
--    then go ahead) or with a full refund (the booking is cancelled). Today a
--    report blocks the payout for good.
-- 2. lokl can cancel a booking after its payout: refunded in full, with the
--    provider's transfer reversed, or the reversal's failure recorded as
--    money owed.
-- 3. Dispute details from Stripe's webhook, for the Disputes page.
-- 4. admin_actions: who did what, when and why, for every admin action
--    (bookings, emails, provider suspensions). The start of the admin audit
--    log (docs/TODO.md).
-- 5. commission_rate_changes: the history of commission rate changes.
-- 6. job_runs: every timed job run and what it did, so failures can be listed.
-- 7. Emails when a no-show report is resolved.
--
-- New tables are read by admins only and written only by the server (the
-- service role) or by triggers. Delete behaviour: none of them is deleted.

-- ---------------------------------------------------------------------------
-- 1-3. NEW BOOKING COLUMNS
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column problem_resolved_at timestamptz,
  add column problem_resolution text check (problem_resolution in ('paid_provider', 'refunded')),
  add column stripe_transfer_reversal_id text,
  add column reversal_failed_at timestamptz,
  add column reversal_failure text check (char_length(reversal_failure) <= 500),
  add column dispute_reason text check (char_length(dispute_reason) <= 100),
  add column dispute_amount_cents integer check (dispute_amount_cents >= 0),
  add column dispute_evidence_due_by timestamptz,
  add constraint bookings_problem_resolution_dated check ((problem_resolution is null) = (problem_resolved_at is null));
comment on column public.bookings.problem_resolution is
  'How lokl resolved a no-show report: paid_provider (the payout goes ahead) or refunded (the booking was cancelled with a full refund).';
comment on column public.bookings.stripe_transfer_reversal_id is
  'When lokl cancelled after the payout: the reversal that took the provider''s share back.';
comment on column public.bookings.reversal_failed_at is
  'When lokl cancelled after the payout but the reversal failed (the provider''s balance was empty): the share is owed to lokl. Details in reversal_failure.';
comment on column public.bookings.dispute_evidence_due_by is 'From Stripe: when evidence for the dispute is due.';

-- bookings_guard: as in booking_cancellations, plus cancelling after the
-- payout (lokl only, with the transfer reversed or its failure recorded),
-- and resolving a no-show report.
create or replace function public.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing record;
  v_duration interval;
begin
  select l.kind, l.provider_id, l.duration_minutes, p.owner_id
    into v_listing
    from public.listings l join public.providers p on p.id = l.provider_id
   where l.id = new.listing_id;

  if tg_op = 'INSERT' then
    if v_listing.kind is distinct from new.kind or v_listing.provider_id is distinct from new.provider_id then
      raise exception 'The booking doesn''t match its listing.' using errcode = 'check_violation';
    end if;
    if v_listing.owner_id = new.customer_id then
      raise exception 'You can''t book your own listing.' using errcode = 'check_violation';
    end if;
    if new.session_id is not null and not exists (
      select 1 from public.experience_sessions where id = new.session_id and listing_id = new.listing_id) then
      raise exception 'That session belongs to another listing.' using errcode = 'check_violation';
    end if;
    if new.status <> 'pending_payment' then
      raise exception 'A new booking starts as pending_payment.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: what a booking is, and its money, never change.
  if new.kind is distinct from old.kind or new.listing_id is distinct from old.listing_id
     or new.provider_id is distinct from old.provider_id or new.customer_id is distinct from old.customer_id
     or new.session_id is distinct from old.session_id or new.party_size is distinct from old.party_size
     or new.preferred_times is distinct from old.preferred_times
     or new.unit_price_cents is distinct from old.unit_price_cents or new.total_cents is distinct from old.total_cents
     or new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.commission_cents is distinct from old.commission_cents
     or new.provider_amount_cents is distinct from old.provider_amount_cents
     or new.customer_city is distinct from old.customer_city
     or new.customer_postal_code is distinct from old.customer_postal_code then
    raise exception 'A booking''s listing, customer, size, times offered and price can''t be changed.'
      using errcode = 'check_violation';
  end if;
  if new.refunded_cents < old.refunded_cents then
    raise exception 'A refund can''t be undone.' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending_payment' and new.status in ('requested', 'confirmed', 'expired', 'cancelled'))
      or (old.status = 'requested' and new.status in ('confirmed', 'declined', 'expired', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('completed', 'cancelled'))
      or (old.status = 'completed' and new.status in ('paid_out', 'cancelled'))
      -- lokl cancels after the payout: refunded, and the transfer reversed
      -- (or the reversal's failure recorded as money owed).
      or (old.status = 'paid_out' and new.status = 'cancelled')
      -- A customer who cancels within 48 hours gets no refund, and the
      -- provider is still paid their share at payout.
      or (old.status = 'cancelled' and new.status = 'paid_out'
          and old.cancelled_by = 'customer' and old.refunded_cents = 0 and old.confirmed_at is not null)
    ) then
      raise exception 'A booking can''t go from % to %.', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'requested' and new.kind <> 'service' then
      raise exception 'Only Service bookings are requested.' using errcode = 'check_violation';
    end if;
    if new.status = 'confirmed' and old.status = 'pending_payment' and new.kind <> 'experience' then
      raise exception 'A Service is confirmed by the provider accepting a request.' using errcode = 'check_violation';
    end if;
    -- A reported problem holds the payout until lokl resolves it in the
    -- provider's favour.
    if new.status = 'paid_out' and new.problem_reported_at is not null
       and new.problem_resolution is distinct from 'paid_provider' then
      raise exception 'A reported problem holds the payout.' using errcode = 'check_violation';
    end if;
    -- Paid out means a transfer was made, nothing holds it, and no dispute
    -- is open.
    if new.status = 'paid_out' then
      if new.stripe_transfer_id is null then
        raise exception 'A booking is paid out only with its transfer recorded.' using errcode = 'check_violation';
      end if;
      if new.payout_hold is not null then
        raise exception 'This payout is on hold for lokl to review.' using errcode = 'check_violation';
      end if;
      if new.disputed_at is not null and new.dispute_closed_at is null then
        raise exception 'An open dispute holds the payout.' using errcode = 'check_violation';
      end if;
    end if;
    -- Accepting a request: before the answer-by time, and for a time that
    -- hasn't passed.
    if old.status = 'requested' and new.status = 'confirmed' then
      if old.respond_by is not null and now() > old.respond_by then
        raise exception 'The time to answer this request has passed.' using errcode = 'check_violation';
      end if;
      if new.starts_at <= now() then
        raise exception 'That time has already passed.' using errcode = 'check_violation';
      end if;
    end if;
    if new.status = 'confirmed' then
      if new.kind = 'service' and not (new.starts_at = any (new.preferred_times)) then
        raise exception 'Accept one of the times the customer offered.' using errcode = 'check_violation';
      end if;
      v_duration := make_interval(mins => coalesce(v_listing.duration_minutes, 0));
      new.confirmed_at := now();
      new.ends_at := new.starts_at + v_duration;
      new.payout_due_at := new.ends_at + interval '24 hours';
    end if;
    if new.status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
      if new.cancelled_by is null then
        raise exception 'Say who cancelled the booking.' using errcode = 'check_violation';
      end if;
      -- The cancellation policy (decision 5, and the 1-hour grace period
      -- decided 2026-10-02), for bookings that were paid.
      if old.status in ('confirmed', 'completed', 'paid_out') then
        if old.status = 'completed' and new.cancelled_by not in ('admin', 'system') then
          raise exception 'This booking has already happened, so only lokl can cancel it.' using errcode = 'check_violation';
        end if;
        if old.status = 'paid_out' then
          if new.cancelled_by <> 'admin' then
            raise exception 'Only lokl can cancel a booking that has been paid out.' using errcode = 'check_violation';
          end if;
          if new.stripe_transfer_reversal_id is null and new.reversal_failed_at is null then
            raise exception 'Reverse the provider''s transfer (or record why it failed) before cancelling a paid-out booking.'
              using errcode = 'check_violation';
          end if;
        end if;
        if new.cancelled_by in ('customer', 'provider') and now() >= old.starts_at then
          raise exception 'This booking has started, so it can''t be cancelled.' using errcode = 'check_violation';
        end if;
        if new.cancelled_by = 'provider' and coalesce(char_length(trim(new.cancel_reason)), 0) < 5 then
          raise exception 'Say why you''re cancelling. The customer sees it.' using errcode = 'check_violation';
        end if;
        -- Full refund: the provider, lokl or the system cancelled; or the
        -- customer did 48 hours or more ahead, or within an hour of booking.
        if (new.cancelled_by <> 'customer'
            or now() <= old.starts_at - interval '48 hours'
            or now() <= old.confirmed_at + interval '1 hour')
           and new.refunded_cents < new.total_cents then
          raise exception 'This cancellation gets a full refund. Refund it before cancelling.' using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;

  -- "The provider didn't show up": once, with a note, between the start and
  -- the payout time, on a booking that happened and isn't paid out.
  if old.problem_reported_at is not null
     and (new.problem_reported_at is distinct from old.problem_reported_at or new.problem_note is distinct from old.problem_note) then
    raise exception 'A problem has already been reported on this booking.' using errcode = 'check_violation';
  end if;
  if old.problem_reported_at is null and new.problem_reported_at is not null then
    if old.status not in ('confirmed', 'completed') or now() < old.starts_at or now() >= old.payout_due_at then
      raise exception 'A problem can be reported from the start of a booking until its payout.' using errcode = 'check_violation';
    end if;
    if coalesce(char_length(trim(new.problem_note)), 0) < 10 then
      raise exception 'Say what happened, in a sentence or two.' using errcode = 'check_violation';
    end if;
  end if;

  -- Resolving a no-show report (lokl only): once, on a reported booking. A
  -- refund resolves it with the booking cancelled and refunded in full.
  if old.problem_resolution is not null
     and (new.problem_resolution is distinct from old.problem_resolution or new.problem_resolved_at is distinct from old.problem_resolved_at) then
    raise exception 'This report has already been resolved.' using errcode = 'check_violation';
  end if;
  if old.problem_resolution is null and new.problem_resolution is not null then
    if new.problem_reported_at is null then
      raise exception 'Only a reported problem can be resolved.' using errcode = 'check_violation';
    end if;
    if new.problem_resolution = 'refunded' and (new.status <> 'cancelled' or new.refunded_cents < new.total_cents) then
      raise exception 'Resolving a report with a refund cancels the booking and refunds it in full.' using errcode = 'check_violation';
    end if;
  end if;

  if new.status is distinct from old.status then
    null; -- (checked above)
  elsif new.starts_at is distinct from old.starts_at or new.payout_due_at is distinct from old.payout_due_at
        or new.confirmed_at is distinct from old.confirmed_at then
    raise exception 'A booking''s time and payout date only change with its status.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
comment on function public.bookings_guard() is
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size and price, follows the allowed status changes, is accepted only in time, is paid out only with a transfer, no hold, no open dispute and no unresolved report, follows the cancellation policy, takes one no-show report between the start and the payout, is resolved once, and is cancelled after its payout only by lokl, with the transfer reversed or its failure recorded.';

-- ---------------------------------------------------------------------------
-- 4. ADMIN ACTIONS
-- ---------------------------------------------------------------------------

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users (id) on delete set null,
  target text not null check (target in ('booking', 'provider', 'email')),
  target_id uuid not null,
  action text not null check (action in (
    'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded',
    'retry_email', 'suspend_provider', 'reinstate_provider')),
  reason text check (char_length(reason) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_actions_reason check (action = 'retry_email' or char_length(trim(reason)) >= 5)
);
comment on table public.admin_actions is
  'Every admin action on bookings, emails and providers: who, what, when and why. Written by the website''s admin routes with the service role; read by admins. Never deleted.';
create index admin_actions_target_idx on public.admin_actions (target, target_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. COMMISSION RATE HISTORY
-- ---------------------------------------------------------------------------

create table public.commission_rate_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('service', 'experience')),
  old_rate_bps integer not null,
  new_rate_bps integer not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default clock_timestamp()
);
comment on table public.commission_rate_changes is
  'Each change to a commission rate: from, to, who and when. Filled by a trigger on commission_rates; read by admins. Never deleted.';

create or replace function public.commission_rates_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.commission_rate_changes (kind, old_rate_bps, new_rate_bps, changed_by)
  values (new.kind, old.rate_bps, new.rate_bps, auth.uid());
  return null;
end;
$$;
comment on function public.commission_rates_log_change() is
  'Trigger function: records each commission rate change in commission_rate_changes.';
create trigger commission_rates_log_change
  after update of rate_bps on public.commission_rates
  for each row when (old.rate_bps is distinct from new.rate_bps)
  execute function public.commission_rates_log_change();

-- ---------------------------------------------------------------------------
-- 6. JOB RUNS
-- ---------------------------------------------------------------------------

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (char_length(job) <= 60),
  started_at timestamptz not null,
  finished_at timestamptz not null default clock_timestamp(),
  checked integer not null default 0,
  changed integer not null default 0,
  failed integer not null default 0,
  failures text[] not null default '{}',
  error text check (char_length(error) <= 1000)
);
comment on table public.job_runs is
  'Each timed job run (website /api/jobs/*): how many bookings it looked at, changed and couldn''t handle, with the failures. Written by the website''s server; read by admins.';
create index job_runs_recent_idx on public.job_runs (finished_at desc);

-- ---------------------------------------------------------------------------
-- WHO CAN SEE THE NEW TABLES: admins read, nobody else; the server writes.
-- ---------------------------------------------------------------------------

alter table public.admin_actions enable row level security;
alter table public.commission_rate_changes enable row level security;
alter table public.job_runs enable row level security;
revoke all on public.admin_actions, public.commission_rate_changes, public.job_runs from anon, authenticated;
grant select on public.admin_actions, public.commission_rate_changes, public.job_runs to authenticated;

create policy admin_actions_read_admin on public.admin_actions for select to authenticated using ((select public.is_admin()));
comment on policy admin_actions_read_admin on public.admin_actions is 'Admins can read every admin action.';
create policy commission_rate_changes_read_admin on public.commission_rate_changes for select to authenticated using ((select public.is_admin()));
comment on policy commission_rate_changes_read_admin on public.commission_rate_changes is 'Admins can read the commission rate history.';
create policy job_runs_read_admin on public.job_runs for select to authenticated using ((select public.is_admin()));
comment on policy job_runs_read_admin on public.job_runs is 'Admins can read the job runs.';

-- ---------------------------------------------------------------------------
-- 7. EMAILS WHEN A REPORT IS RESOLVED
-- ---------------------------------------------------------------------------

alter table public.booking_emails
  drop constraint booking_emails_kind_check,
  add constraint booking_emails_kind_check check (kind in (
    'customer_request_sent', 'customer_request_accepted', 'customer_request_declined',
    'customer_request_expired', 'customer_booking_confirmed', 'customer_booking_cancelled',
    'customer_problem_received', 'customer_problem_refunded',
    'provider_new_request', 'provider_new_booking', 'provider_booking_cancelled',
    'provider_request_unanswered', 'provider_payout_sent', 'provider_problem_reported',
    'provider_payout_problem', 'provider_problem_paid', 'provider_problem_refunded'));

-- bookings_queue_emails: as in booking_emails, plus a report's resolution
-- (which replaces the cancellation emails when it's a refund), and
-- cancellations after a payout.
create or replace function public.bookings_queue_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text[] := '{}';
begin
  if new.status is distinct from old.status then
    v := v || case
      when new.status = 'requested' then
        array['customer_request_sent', 'provider_new_request']
      when old.status = 'requested' and new.status = 'confirmed' then
        array['customer_request_accepted']
      when old.status = 'pending_payment' and new.status = 'confirmed' then
        array['customer_booking_confirmed', 'provider_new_booking']
      when old.status = 'requested' and new.status = 'declined' then
        array['customer_request_declined']
      -- No answer in time (the system): both hear. The card failing when
      -- the provider accepted: only the customer (the provider saw it).
      when old.status = 'requested' and new.status = 'expired' then
        case when new.status_changed_by = 'system'
          then array['customer_request_expired', 'provider_request_unanswered']
          else array['customer_request_expired'] end
      -- Refunded because of a no-show report: the report's own emails
      -- instead of the usual cancellation ones (below).
      when new.status = 'cancelled' and new.problem_resolution = 'refunded' and old.problem_resolution is null then
        '{}'::text[]
      when new.status = 'cancelled' and old.status in ('requested', 'confirmed', 'completed', 'paid_out') then
        case when new.cancelled_by = 'provider'
          then array['customer_booking_cancelled']
          else array['customer_booking_cancelled', 'provider_booking_cancelled'] end
      when new.status = 'paid_out' then
        array['provider_payout_sent']
      else '{}'::text[]
    end;
  end if;
  if old.problem_reported_at is null and new.problem_reported_at is not null then
    v := v || array['customer_problem_received', 'provider_problem_reported'];
  end if;
  if old.problem_resolution is null and new.problem_resolution = 'paid_provider' then
    v := v || array['provider_problem_paid'];
  end if;
  if old.problem_resolution is null and new.problem_resolution = 'refunded' then
    v := v || array['customer_problem_refunded', 'provider_problem_refunded'];
  end if;
  if old.payout_hold is null and new.payout_hold in ('account_cannot_receive', 'transfer_failed') then
    v := v || array['provider_payout_problem'];
  end if;
  if cardinality(v) > 0 then
    perform public.booking_emails_queue(new.id, v);
  end if;
  return null;
end;
$$;

drop trigger bookings_queue_emails on public.bookings;
create trigger bookings_queue_emails
  after update of status, problem_reported_at, payout_hold, problem_resolution on public.bookings
  for each row execute function public.bookings_queue_emails();
