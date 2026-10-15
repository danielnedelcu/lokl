-- Service availability, phase 3 (docs/design/service-availability.md):
-- Services are booked from slots only. The old request flow goes: its
-- function (create_service_request) and its column (bookings.preferred_times).
-- service_next_slot (section 4) finds a Service's first free time anywhere in
-- its booking window, for the listing page and the scheduling panel.
--
-- lokl isn't live: the hosted data is test data (counted 2026-10-15: 4
-- Service bookings, all made the old way: 1 cancelled, 1 confirmed and 2
-- declined without a start). They're converted in one step, with the
-- booking triggers off (decided 2026-10-15: no emails, notifications or
-- status history for test data), and the migration then proves every
-- booking trigger and every log guard is back on.

-- ---------------------------------------------------------------------------
-- 1. THE TEST DATA, IN ONE STEP
-- ---------------------------------------------------------------------------

-- The old shape rules go first: phase 1's says a booking with a mode has
-- no offered times, which converting old requests to Approve would break.
-- The new ones are added once the column has gone (section 2).
alter table public.bookings
  drop constraint bookings_service_shape,
  drop constraint bookings_experience_shape;

alter table public.bookings disable trigger user;

-- Any old request still open: expired by the system (hosted: none).
update public.bookings set status = 'expired', status_changed_by = 'system'
 where kind = 'service' and service_mode is null and status in ('pending_payment', 'requested');
-- A request never accepted takes the first time it offered (declined and
-- expired requests: they show as Declined or Expired, never as happened).
update public.bookings b
   set starts_at = b.preferred_times[1],
       ends_at = b.preferred_times[1] + make_interval(mins => coalesce(l.duration_minutes, 60))
  from public.listings l
 where l.id = b.listing_id and b.kind = 'service' and b.starts_at is null;
-- Every old Service booking was a request: Approve.
update public.bookings set service_mode = 'approve' where kind = 'service' and service_mode is null;

alter table public.bookings enable trigger user;

-- Every booking trigger is on again, or the migration stops here.
do $$
declare
  v_off text;
begin
  select string_agg(tgname, ', ') into v_off
    from pg_trigger where tgrelid = 'public.bookings'::regclass and not tgisinternal and tgenabled = 'D';
  if v_off is not null then
    raise exception 'Booking triggers still off: %', v_off;
  end if;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.bookings'::regclass and not tgisinternal and tgenabled <> 'D'
         and tgname in ('bookings_guard', 'bookings_hold', 'bookings_log_status', 'bookings_queue_emails',
                        'bookings_notify_provider', 'bookings_refuse_delete', 'bookings_refuse_delete_truncate')) <> 7 then
    raise exception 'A booking trigger is missing or off (bookings_guard, bookings_hold, bookings_log_status, bookings_queue_emails, bookings_notify_provider, bookings_refuse_delete, bookings_refuse_delete_truncate).';
  end if;
end;
$$;
select public.assert_log_guards_on();

-- ---------------------------------------------------------------------------
-- 2. THE OLD FLOW GOES
-- ---------------------------------------------------------------------------

drop function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz, uuid, text);

-- private.booking_records is "select b.*", which Postgres fixed to the
-- columns bookings had when it was made; it's dropped and made again so the
-- column can go. It's exactly as before, except: preferred_times is gone,
-- and b.* now also brings the columns added since (checkout_key,
-- checkout_request_hash, service_mode). Its update trigger no longer writes
-- preferred_times.
drop view private.booking_records;

alter table public.bookings drop column preferred_times;

-- Every Service booking is a slot: its mode, start and end set when it's made.
alter table public.bookings
  add constraint bookings_service_shape check (kind <> 'service' or (session_id is null and party_size = 1
      and service_mode is not null and starts_at is not null and ends_at is not null)),
  -- (An Experience booking has no mode: bookings_service_mode_only_services, phase 1.)
  add constraint bookings_experience_shape check (kind <> 'experience' or session_id is not null);

create view private.booking_records with (security_invoker = true) as
select b.*, f.commission_rate_bps, f.commission_cents, f.provider_amount_cents, f.payout_hold, f.payout_held_at, f.payout_failed_at, f.payout_failure, f.stripe_checkout_session_id, f.stripe_payment_intent_id, f.stripe_charge_id, f.stripe_transfer_id, f.stripe_transfer_reversal_id, f.reversal_failed_at, f.reversal_failure, f.stripe_dispute_id, f.disputed_at, f.dispute_closed_at, f.dispute_outcome, f.dispute_reason, f.dispute_amount_cents, f.dispute_evidence_due_by, r.note as problem_note, f.payout_holds_released
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
    payout_holds_released = new.payout_holds_released,
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
revoke all on function private.booking_records_update() from public, anon, authenticated;

create trigger booking_records_update
  instead of update on private.booking_records
  for each row execute function private.booking_records_update();

-- ---------------------------------------------------------------------------
-- 3. THE BOOKING GUARD, WITHOUT OFFERED TIMES
-- ---------------------------------------------------------------------------

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
  v_accepted_at timestamptz;
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
     or new.service_mode is distinct from old.service_mode
     or new.unit_price_cents is distinct from old.unit_price_cents or new.total_cents is distinct from old.total_cents
     or new.customer_city is distinct from old.customer_city
     or new.customer_postal_code is distinct from old.customer_postal_code then
    raise exception 'A booking''s listing, customer, size, mode and price can''t be changed.'
      using errcode = 'check_violation';
  end if;
  -- A Service keeps its time: the slot was chosen, checked and held when the
  -- booking was made.
  if old.kind = 'service'
     and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    raise exception 'A booked time can''t be changed.' using errcode = 'check_violation';
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
    if new.status = 'confirmed' and old.status = 'pending_payment' and new.kind <> 'experience'
       and new.service_mode is distinct from 'instant' then
      raise exception 'A Service is confirmed by the provider accepting a request.' using errcode = 'check_violation';
    end if;
    if new.status = 'requested' and new.service_mode = 'instant' then
      raise exception 'An instant booking is confirmed when it''s paid, not requested.' using errcode = 'check_violation';
    end if;
    -- An approval booking is answered at least 2 hours before it starts
    -- (and within 48 hours of the payment, which the server sets).
    if new.status = 'requested' and new.service_mode = 'approve' then
      new.respond_by := least(coalesce(new.respond_by, new.starts_at - interval '2 hours'), new.starts_at - interval '2 hours');
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
    -- hasn't passed. When the provider accepted is now, or, when a lost
    -- reply is finished later (a retry, Stripe's webhook, the expiry job),
    -- the time Stripe captured the card, which the server passes as
    -- confirmed_at: between the request and now.
    if old.status = 'requested' and new.status = 'confirmed' then
      v_accepted_at := case when new.confirmed_at is distinct from old.confirmed_at then new.confirmed_at end;
      if v_accepted_at is not null and (v_accepted_at > now() or v_accepted_at < old.created_at) then
        raise exception 'A request is accepted between when it was made and now.' using errcode = 'check_violation';
      end if;
      if old.respond_by is not null and coalesce(v_accepted_at, now()) > old.respond_by then
        raise exception 'The time to answer this request has passed.' using errcode = 'check_violation';
      end if;
      if new.starts_at <= now() then
        raise exception 'That time has already passed.' using errcode = 'check_violation';
      end if;
    end if;
    if new.status = 'confirmed' then
      new.confirmed_at := coalesce(v_accepted_at, now());
      -- A Service's end was set (and held) when it was booked; an
      -- Experience's comes from its listing.
      if new.kind = 'experience' then
        v_duration := make_interval(mins => coalesce(v_listing.duration_minutes, 0));
        new.ends_at := new.starts_at + v_duration;
      end if;
      new.payout_due_at := new.ends_at + interval '24 hours';
    end if;
    if new.status = 'cancelled' then
      -- When it was cancelled: now, or, when a lost reply is finished later,
      -- the time Stripe made the refund, which the server passes: between
      -- the booking and now. The policy below goes by this time.
      new.cancelled_at := least(coalesce(new.cancelled_at, now()), now());
      if new.cancelled_at < coalesce(old.confirmed_at, old.created_at) then
        raise exception 'A booking is cancelled between when it was booked and now.' using errcode = 'check_violation';
      end if;
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
        if new.cancelled_by in ('customer', 'provider') and new.cancelled_at >= old.starts_at then
          raise exception 'This booking has started, so it can''t be cancelled.' using errcode = 'check_violation';
        end if;
        if new.cancelled_by = 'provider' and coalesce(char_length(trim(new.cancel_reason)), 0) < 5 then
          raise exception 'Say why you''re cancelling. The customer sees it.' using errcode = 'check_violation';
        end if;
        -- Full refund: the provider, lokl or the system cancelled; or the
        -- customer did 48 hours or more ahead, or within an hour of booking.
        if (new.cancelled_by <> 'customer'
            or new.cancelled_at <= old.starts_at - interval '48 hours'
            or new.cancelled_at <= old.confirmed_at + interval '1 hour')
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

comment on function public.bookings_guard() is
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size, mode and price, follows the allowed status changes (an instant Service is confirmed when paid and never requested; an approval Service is answered at least 2 hours before it starts), keeps a Service''s time (its slot), is accepted only before its answer-by time (judged at confirmed_at when the server passes the time Stripe captured the card) and for a time still ahead, gets its payout time (24 hours after the end) on confirmation (and, for an Experience, its end), and is cancelled under the policy as of cancelled_at (now, or the time Stripe refunded).';

-- ---------------------------------------------------------------------------
-- 4. THE NEXT FREE SLOT (the listing page and the scheduling panel)
-- ---------------------------------------------------------------------------
-- service_slots answers at most 31 days at a time; the booking window runs
-- to 180. The listing page needs to know whether a Service has any time at
-- all ("Not taking bookings yet" when it doesn't), and the panel offers
-- "Next available" when a week has none, so this walks the window in
-- 31-day steps and stops at the first slot.

create function public.service_next_slot(p_listing_id uuid, p_from date default null)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_today date;
  v_window smallint;
  v_day date;
  v_found timestamptz;
begin
  select c.timezone, coalesce(s.booking_window_days, 60)
    into v_zone, v_window
    from public.listings l
    join public.cities c on c.id = l.city_id
    left join public.provider_schedules s on s.provider_id = l.provider_id
   where l.id = p_listing_id and l.kind = 'service';
  if v_zone is null then
    return null;
  end if;
  v_today := (now() at time zone v_zone)::date;
  v_day := greatest(coalesce(p_from, v_today), v_today);
  while v_day <= v_today + v_window loop
    select min(x.starts_at) into v_found
      from public.service_slots_core(p_listing_id, v_day, v_day + 30, now(), true) x;
    if v_found is not null then
      return v_found;
    end if;
    v_day := v_day + 31;
  end loop;
  return null;
end;
$$;

comment on function public.service_next_slot(uuid, date) is
  'The first time customers can book a Service from, on or after a market date (today when null), anywhere in its booking window; null when it has none (no hours, all taken, or not bookable). The same slots as service_slots. For visitors and signed-in users.';

grant execute on function public.service_next_slot(uuid, date) to anon, authenticated;
