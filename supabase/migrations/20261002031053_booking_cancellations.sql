-- Step 4, part 6: cancellations, refunds and no-show reports.
--
-- 1. The cancellation policy in the database (bookings_guard): a paid
--    booking cancelled by the provider, lokl or the system is refunded in
--    full; a customer gets a full refund 48 hours or more before the start,
--    or within 1 hour of the booking being confirmed (the grace period,
--    decided 2026-10-02), as long as it hasn't started. Only lokl cancels a
--    booking once it has started. A provider says why.
-- 2. "The provider didn't show up": once, with a note, from the start until
--    the payout time.
-- 3. The provider's bell says when a problem is reported (without the
--    customer's note, which only the admin reads: decided 2026-10-02).
--
-- No new access rules: signed-in users still write nothing on bookings; the
-- server routes do, after checking who's asking. Delete behaviour is
-- unchanged.

-- ---------------------------------------------------------------------------
-- 1 and 2. THE POLICY AND THE REPORT (bookings_guard)
-- ---------------------------------------------------------------------------

-- bookings_guard: as in booking_payouts, plus the cancellation policy and
-- the problem-report rules.
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
    if new.status = 'paid_out' and new.problem_reported_at is not null then
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
      if old.status in ('confirmed', 'completed') then
        if old.status = 'completed' and new.cancelled_by not in ('admin', 'system') then
          raise exception 'This booking has already happened, so only lokl can cancel it.' using errcode = 'check_violation';
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
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size and price, follows the allowed status changes, is accepted only in time, is paid out only with a transfer, no hold and no open dispute, follows the cancellation policy (full refund unless the customer cancels within 48 hours and after the 1-hour grace period), and takes one no-show report, with a note, between the start and the payout.';

-- ---------------------------------------------------------------------------
-- 3. THE PROVIDER HEARS ABOUT A REPORT
-- ---------------------------------------------------------------------------

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in (
    'listing_approved', 'listing_rejected', 'listing_unpublished', 'listing_restored',
    'booking_requested', 'booking_confirmed', 'booking_cancelled', 'booking_problem_reported'));

create or replace function public.bookings_notify_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (provider_id, kind, listing_id, booking_id)
  values (new.provider_id, 'booking_problem_reported', new.listing_id, new.id);
  return null;
end;
$$;
comment on function public.bookings_notify_problem() is
  'Trigger function: tells the provider a customer reported a problem with a booking (the note itself stays with lokl).';

create trigger bookings_notify_problem
  after update of problem_reported_at on public.bookings
  for each row when (old.problem_reported_at is null and new.problem_reported_at is not null)
  execute function public.bookings_notify_problem();
