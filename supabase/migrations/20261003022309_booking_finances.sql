-- Booking finances only the provider and lokl can read (decided 2026-10-03).
--
-- Until now every column of a booking was readable by its customer and its
-- provider (the row rules decide which bookings, not which columns), so a
-- customer could read the commission split, the provider's payout state and
-- failures, and every Stripe id, and a provider could read the customer's
-- no-show note, which only lokl is meant to see. The same pattern as listing
-- addresses fixes both:
--
-- 1. booking_finances (one row per booking): the commission split, payout
--    holds and failures, Stripe ids, dispute and reversal details. Read by
--    the booking's provider and admins; never by the customer.
-- 2. booking_reports (one row per no-show report): the customer's note.
--    Read by that customer and admins; never by the provider. Final once
--    written.
-- 3. private.booking_records: the booking with its finances and note, for
--    the website's server only. It's in its own schema, `private`, which
--    the API exposes but only the service role may use (no USAGE for anon
--    or authenticated), and it's updatable: one statement writes both
--    tables (finances first, so the booking's rules see them), keeping
--    status changes and their money atomic.
-- 4. Data: every booking's values are copied across, then the old columns
--    are dropped. payout_due_at stays on bookings (the customer's no-show
--    window ends at it; it's only a date).
--
-- Delete behaviour: neither table is ever deleted (bookings aren't either).

-- ---------------------------------------------------------------------------
-- 1. BOOKING FINANCES
-- ---------------------------------------------------------------------------

create table public.booking_finances (
  booking_id uuid primary key references public.bookings (id) on delete restrict,
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 5000),
  commission_cents integer not null check (commission_cents >= 0),
  provider_amount_cents integer not null check (provider_amount_cents >= 0),
  payout_hold text check (payout_hold in
    ('problem_reported', 'dispute', 'refunded', 'provider_suspended', 'account_cannot_receive', 'transfer_failed')),
  payout_held_at timestamptz,
  payout_failed_at timestamptz,
  payout_failure text check (char_length(payout_failure) <= 500),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  stripe_transfer_id text unique,
  stripe_transfer_reversal_id text,
  reversal_failed_at timestamptz,
  reversal_failure text check (char_length(reversal_failure) <= 500),
  stripe_dispute_id text,
  disputed_at timestamptz,
  dispute_closed_at timestamptz,
  dispute_outcome text check (dispute_outcome in ('won', 'lost', 'warning_closed')),
  dispute_reason text check (char_length(dispute_reason) <= 100),
  dispute_amount_cents integer check (dispute_amount_cents >= 0),
  dispute_evidence_due_by timestamptz,
  constraint booking_finances_hold_dated check ((payout_hold is null) = (payout_held_at is null)),
  constraint booking_finances_dispute_order check (dispute_closed_at is null or disputed_at is not null)
);
comment on table public.booking_finances is
  'A booking''s money side: the commission split (copied at booking), payout holds and failures, Stripe ids, dispute and reversal details. Read by the booking''s provider and admins, never the customer; written by the server. Never deleted.';
-- Lookups by charge or dispute (payment intent, checkout session and
-- transfer ids are already indexed by their unique constraints).
create index booking_finances_charge_idx on public.booking_finances (stripe_charge_id) where stripe_charge_id is not null;
create index booking_finances_dispute_idx on public.booking_finances (stripe_dispute_id) where stripe_dispute_id is not null;

comment on column public.booking_finances.payout_hold is
  'Why this booking''s payout is held for lokl to review (see the pay-out job). Set by the job; cleared only by the admin.';
comment on column public.booking_finances.stripe_charge_id is
  'Stripe ids are readable by the booking''s provider, though no page shows them (a possible later refinement: docs/design/booking-and-checkout.md).';

-- The money a booking was made with never changes, and it adds up.
create or replace function public.booking_finances_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
begin
  if tg_op = 'INSERT' then
    select total_cents into v_total from public.bookings where id = new.booking_id;
    if new.commission_cents + new.provider_amount_cents is distinct from v_total then
      raise exception 'The commission and the provider''s share must add up to the booking''s total.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.booking_id is distinct from old.booking_id or new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.commission_cents is distinct from old.commission_cents or new.provider_amount_cents is distinct from old.provider_amount_cents then
    raise exception 'A booking''s commission split can''t be changed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.booking_finances_guard() is
  'Trigger function: a booking''s commission split adds up to its total and never changes.';
create trigger booking_finances_guard
  before insert or update on public.booking_finances
  for each row execute function public.booking_finances_guard();

-- ---------------------------------------------------------------------------
-- 2. NO-SHOW REPORTS
-- ---------------------------------------------------------------------------

create table public.booking_reports (
  booking_id uuid primary key references public.bookings (id) on delete restrict,
  note text not null check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
comment on table public.booking_reports is
  'The customer''s "the provider didn''t show up" note. Read by that customer and admins, never the provider; written by the server; final once written. Never deleted.';

create or replace function public.booking_reports_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A problem has already been reported on this booking.' using errcode = 'check_violation';
end;
$$;
comment on function public.booking_reports_final() is 'Trigger function: a no-show report never changes once written.';
create trigger booking_reports_final
  before update on public.booking_reports
  for each row execute function public.booking_reports_final();

-- ---------------------------------------------------------------------------
-- DATA: copy every booking's values across, unchanged
-- ---------------------------------------------------------------------------

insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents, payout_hold, payout_held_at, payout_failed_at, payout_failure, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id, stripe_transfer_reversal_id, reversal_failed_at, reversal_failure, stripe_dispute_id, disputed_at, dispute_closed_at, dispute_outcome, dispute_reason, dispute_amount_cents, dispute_evidence_due_by)
select id, commission_rate_bps, commission_cents, provider_amount_cents, payout_hold, payout_held_at, payout_failed_at, payout_failure, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id, stripe_transfer_reversal_id, reversal_failed_at, reversal_failure, stripe_dispute_id, disputed_at, dispute_closed_at, dispute_outcome, dispute_reason, dispute_amount_cents, dispute_evidence_due_by from public.bookings;
insert into public.booking_reports (booking_id, note, created_at)
select id, problem_note, coalesce(problem_reported_at, now()) from public.bookings where problem_note is not null;

-- ---------------------------------------------------------------------------
-- THE RULES THAT READ THE MOVED COLUMNS
-- ---------------------------------------------------------------------------

-- The email trigger names payout_hold in its column list, so it goes before
-- the column does; it's recreated below without it.
drop trigger bookings_queue_emails on public.bookings;

alter table public.bookings
  drop column commission_rate_bps, drop column commission_cents, drop column provider_amount_cents,
  drop column payout_hold, drop column payout_held_at, drop column payout_failed_at, drop column payout_failure,
  drop column stripe_checkout_session_id, drop column stripe_payment_intent_id, drop column stripe_charge_id,
  drop column stripe_transfer_id, drop column stripe_transfer_reversal_id, drop column reversal_failed_at,
  drop column reversal_failure, drop column stripe_dispute_id, drop column disputed_at, drop column dispute_closed_at,
  drop column dispute_outcome, drop column dispute_reason, drop column dispute_amount_cents,
  drop column dispute_evidence_due_by, drop column problem_note;

-- bookings_guard: as in booking_admin, reading the money from
-- booking_finances and the note from booking_reports.
create or replace function public.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing record;
  v_duration interval;
  v_fin public.booking_finances;
  v_note text;
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
     or new.customer_city is distinct from old.customer_city
     or new.customer_postal_code is distinct from old.customer_postal_code then
    raise exception 'A booking''s listing, customer, size, times offered and price can''t be changed.'
      using errcode = 'check_violation';
  end if;
  -- The money side lives in booking_finances (written first, in the same
  -- statement, through private.booking_records); read it for the checks below.
  select * into v_fin from public.booking_finances where booking_id = new.id;
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
      if v_fin.stripe_transfer_id is null then
        raise exception 'A booking is paid out only with its transfer recorded.' using errcode = 'check_violation';
      end if;
      if v_fin.payout_hold is not null then
        raise exception 'This payout is on hold for lokl to review.' using errcode = 'check_violation';
      end if;
      if v_fin.disputed_at is not null and v_fin.dispute_closed_at is null then
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
          if v_fin.stripe_transfer_reversal_id is null and v_fin.reversal_failed_at is null then
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
  -- (The note itself is in booking_reports, which never changes once written.)
  if old.problem_reported_at is not null and new.problem_reported_at is distinct from old.problem_reported_at then
    raise exception 'A problem has already been reported on this booking.' using errcode = 'check_violation';
  end if;
  if old.problem_reported_at is null and new.problem_reported_at is not null then
    if old.status not in ('confirmed', 'completed') or now() < old.starts_at or now() >= old.payout_due_at then
      raise exception 'A problem can be reported from the start of a booking until its payout.' using errcode = 'check_violation';
    end if;
    select note into v_note from public.booking_reports where booking_id = new.id;
    if coalesce(char_length(trim(v_note)), 0) < 10 then
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

-- bookings_queue_emails: as in booking_admin, without payout holds (they're
-- on booking_finances now, queued below).
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
  if cardinality(v) > 0 then
    perform public.booking_emails_queue(new.id, v);
  end if;
  return null;
end;
$$;

create trigger bookings_queue_emails
  after update of status, problem_reported_at, problem_resolution on public.bookings
  for each row execute function public.bookings_queue_emails();

-- A payout the provider's account couldn't take emails the provider.
create or replace function public.booking_finances_queue_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.booking_emails_queue(new.booking_id, array['provider_payout_problem']);
  return null;
end;
$$;
comment on function public.booking_finances_queue_emails() is
  'Trigger function: queues the provider''s "we couldn''t send your payout" email when a payout is held because their account can''t take it.';
create trigger booking_finances_queue_emails
  after update of payout_hold on public.booking_finances
  for each row when (old.payout_hold is null and new.payout_hold in ('account_cannot_receive', 'transfer_failed'))
  execute function public.booking_finances_queue_emails();

-- The two booking functions: as in booking_requests_answers, writing the
-- money to booking_finances.
create or replace function public.reserve_experience_booking(
  p_session_id uuid, p_customer_id uuid, p_party_size smallint, p_customer_name text,
  p_customer_email text, p_customer_phone text, p_customer_notes text, p_reserved_until timestamptz)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_session record;
  v_listing public.listings;
  v_money record;
  v_booking public.bookings;
begin
  select * into v_session from public.experience_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    raise exception 'That date isn''t available any more.' using errcode = 'check_violation';
  end if;
  select * into v_listing from public.listings where id = v_session.listing_id;
  if v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id) then
    raise exception 'This Experience isn''t available to book.' using errcode = 'check_violation';
  end if;
  if public.session_spots_taken(p_session_id) + p_party_size > v_session.capacity then
    raise exception 'There aren''t enough spots left for %.',
      case when p_party_size = 1 then '1 person' else p_party_size || ' people' end
      using errcode = 'check_violation';
  end if;

  select * into v_money from public.booking_money('experience', v_listing.price_cents, p_party_size);
  insert into public.bookings (kind, listing_id, provider_id, customer_id, session_id, starts_at, party_size,
    customer_name, customer_notes, unit_price_cents, total_cents, reserved_until, status_changed_by)
  values ('experience', v_listing.id, v_listing.provider_id, p_customer_id, p_session_id, v_session.starts_at,
    p_party_size, p_customer_name, nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total,
    p_reserved_until, 'customer')
  returning * into v_booking;
  insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents)
  values (v_booking.id, v_money.rate, v_money.commission, v_money.provider_amount);
  insert into public.booking_contacts (booking_id, email, phone) values (v_booking.id, p_customer_email, nullif(p_customer_phone, ''));
  return v_booking;
end;
$$;

create or replace function public.create_service_request(
  p_listing_id uuid, p_customer_id uuid, p_preferred_times timestamptz[], p_customer_name text,
  p_customer_email text, p_customer_phone text, p_customer_notes text, p_address jsonb, p_reserved_until timestamptz)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_money record;
  v_booking public.bookings;
begin
  select * into v_listing from public.listings where id = p_listing_id;
  if v_listing.id is null or v_listing.kind <> 'service' or v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id) then
    raise exception 'This Service isn''t available to book.' using errcode = 'check_violation';
  end if;
  if cardinality(p_preferred_times) not between 1 and 3
     or (select count(distinct t) from unnest(p_preferred_times) t) <> cardinality(p_preferred_times) then
    raise exception 'Offer one to three different times.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(p_preferred_times) t where t < now() + interval '24 hours') then
    raise exception 'Each time needs to be at least 24 hours from now.' using errcode = 'check_violation';
  end if;
  if (v_listing.location_mode = 'customer_location') <> (p_address is not null) then
    raise exception using errcode = 'check_violation', message = case
      when p_address is null then 'Add the address where the Service should happen.'
      else 'This Service happens at the provider''s place, so no address is needed.' end;
  end if;

  select * into v_money from public.booking_money('service', v_listing.price_cents, 1::smallint);
  insert into public.bookings (kind, listing_id, provider_id, customer_id, preferred_times, customer_name,
    customer_notes, unit_price_cents, total_cents, reserved_until, status_changed_by, customer_city, customer_postal_code)
  values ('service', v_listing.id, v_listing.provider_id, p_customer_id, p_preferred_times, p_customer_name,
    nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total, p_reserved_until, 'customer',
    p_address ->> 'city', p_address ->> 'postal_code')
  returning * into v_booking;
  insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents)
  values (v_booking.id, v_money.rate, v_money.commission, v_money.provider_amount);
  insert into public.booking_contacts (booking_id, email, phone) values (v_booking.id, p_customer_email, nullif(p_customer_phone, ''));
  if p_address is not null then
    insert into public.booking_addresses (booking_id, line1, line2, city, state, postal_code, instructions)
    values (v_booking.id, p_address ->> 'line1', nullif(p_address ->> 'line2', ''), p_address ->> 'city',
            p_address ->> 'state', p_address ->> 'postal_code', nullif(p_address ->> 'instructions', ''));
  end if;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- WHO CAN READ THEM
-- ---------------------------------------------------------------------------

alter table public.booking_finances enable row level security;
alter table public.booking_reports enable row level security;
revoke all on public.booking_finances, public.booking_reports from anon, authenticated;
grant select on public.booking_finances, public.booking_reports to authenticated;

create policy booking_finances_read_provider on public.booking_finances for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.provider_id = (select public.current_provider_id())));
comment on policy booking_finances_read_provider on public.booking_finances is
  'Providers can read the money side of bookings on their listings (their share, payouts, holds). Customers can''t.';
create policy booking_finances_read_admin on public.booking_finances for select to authenticated
  using ((select public.is_admin()));
comment on policy booking_finances_read_admin on public.booking_finances is 'Admins can read every booking''s money side.';

create policy booking_reports_read_customer on public.booking_reports for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = (select auth.uid())));
comment on policy booking_reports_read_customer on public.booking_reports is
  'Customers can read the no-show report they wrote. Providers can''t (decided 2026-10-02).';
create policy booking_reports_read_admin on public.booking_reports for select to authenticated
  using ((select public.is_admin()));
comment on policy booking_reports_read_admin on public.booking_reports is 'Admins can read every no-show report.';

-- ---------------------------------------------------------------------------
-- 3. private.booking_records: for the website's server only
-- ---------------------------------------------------------------------------

create schema if not exists private;
comment on schema private is
  'Server-only objects. The API exposes this schema, but only the service role may use it: anon and authenticated have no USAGE.';
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;

create view private.booking_records with (security_invoker = true) as
select b.*, f.commission_rate_bps, f.commission_cents, f.provider_amount_cents, f.payout_hold, f.payout_held_at, f.payout_failed_at, f.payout_failure, f.stripe_checkout_session_id, f.stripe_payment_intent_id, f.stripe_charge_id, f.stripe_transfer_id, f.stripe_transfer_reversal_id, f.reversal_failed_at, f.reversal_failure, f.stripe_dispute_id, f.disputed_at, f.dispute_closed_at, f.dispute_outcome, f.dispute_reason, f.dispute_amount_cents, f.dispute_evidence_due_by, r.note as problem_note
  from public.bookings b
  join public.booking_finances f on f.booking_id = b.id
  left join public.booking_reports r on r.booking_id = b.id;
comment on view private.booking_records is
  'A booking with its finances and no-show note, for the website''s server only (service role). Updatable: one statement writes booking_finances, booking_reports and bookings, in that order, so the booking''s rules see the money.';
revoke all on private.booking_records from public, anon, authenticated;
grant select, update on private.booking_records to service_role;

create or replace function private.booking_records_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.booking_finances set
    commission_rate_bps = new.commission_rate_bps,
    commission_cents = new.commission_cents,
    provider_amount_cents = new.provider_amount_cents,
    payout_hold = new.payout_hold,
    payout_held_at = new.payout_held_at,
    payout_failed_at = new.payout_failed_at,
    payout_failure = new.payout_failure,
    stripe_checkout_session_id = new.stripe_checkout_session_id,
    stripe_payment_intent_id = new.stripe_payment_intent_id,
    stripe_charge_id = new.stripe_charge_id,
    stripe_transfer_id = new.stripe_transfer_id,
    stripe_transfer_reversal_id = new.stripe_transfer_reversal_id,
    reversal_failed_at = new.reversal_failed_at,
    reversal_failure = new.reversal_failure,
    stripe_dispute_id = new.stripe_dispute_id,
    disputed_at = new.disputed_at,
    dispute_closed_at = new.dispute_closed_at,
    dispute_outcome = new.dispute_outcome,
    dispute_reason = new.dispute_reason,
    dispute_amount_cents = new.dispute_amount_cents,
    dispute_evidence_due_by = new.dispute_evidence_due_by
  where booking_id = old.id;
  if new.problem_note is distinct from old.problem_note then
    if old.problem_note is not null then
      raise exception 'A problem has already been reported on this booking.' using errcode = 'check_violation';
    end if;
    insert into public.booking_reports (booking_id, note) values (old.id, new.problem_note);
  end if;
  update public.bookings set
    kind = new.kind,
    listing_id = new.listing_id,
    provider_id = new.provider_id,
    customer_id = new.customer_id,
    session_id = new.session_id,
    status = new.status,
    preferred_times = new.preferred_times,
    starts_at = new.starts_at,
    ends_at = new.ends_at,
    party_size = new.party_size,
    customer_name = new.customer_name,
    customer_notes = new.customer_notes,
    unit_price_cents = new.unit_price_cents,
    total_cents = new.total_cents,
    currency = new.currency,
    refunded_cents = new.refunded_cents,
    refunded_at = new.refunded_at,
    reserved_until = new.reserved_until,
    respond_by = new.respond_by,
    confirmed_at = new.confirmed_at,
    payout_due_at = new.payout_due_at,
    problem_reported_at = new.problem_reported_at,
    cancelled_by = new.cancelled_by,
    cancelled_at = new.cancelled_at,
    cancel_reason = new.cancel_reason,
    status_changed_by = new.status_changed_by,
    customer_city = new.customer_city,
    customer_postal_code = new.customer_postal_code,
    problem_resolved_at = new.problem_resolved_at,
    problem_resolution = new.problem_resolution
  where id = old.id;
  return new;
end;
$$;
comment on function private.booking_records_update() is
  'Trigger function: writes an update of private.booking_records to booking_finances, booking_reports and bookings, in that order.';
revoke all on function private.booking_records_update() from public, anon, authenticated;
create trigger booking_records_update
  instead of update on private.booking_records
  for each row execute function private.booking_records_update();
