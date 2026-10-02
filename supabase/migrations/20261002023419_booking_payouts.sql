-- Step 4, part 5: timed jobs and payouts.
--
-- 1. A payout can be held for lokl to review: a reported no-show, an open
--    dispute, a refund on record, a suspended provider, a provider account
--    that can't receive transfers, or a transfer Stripe refused. The pay-out job sets the hold;
--    it never clears one (the admin does, in part 8).
-- 2. Disputes (chargebacks) are recorded from Stripe's webhooks.
-- 3. paid_out needs the transfer recorded, no hold and no open dispute
--    (bookings_guard), so no code path can mark a held booking paid.
--
-- No new access rules: signed-in users still write nothing on bookings
-- (the new columns are server-only), and reads follow the existing row
-- policies. Delete behaviour is unchanged (bookings are never deleted).

-- ---------------------------------------------------------------------------
-- 1. PAYOUT HOLDS
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column payout_hold text check (payout_hold in
    ('problem_reported', 'dispute', 'refunded', 'provider_suspended', 'account_cannot_receive', 'transfer_failed')),
  add column payout_held_at timestamptz,
  add constraint bookings_payout_hold_dated check ((payout_hold is null) = (payout_held_at is null));
comment on column public.bookings.payout_hold is
  'Why this booking''s payout is held for lokl to review: a reported no-show, an open dispute, a refund on record, a suspended provider, a provider account that can''t receive transfers, or a refused transfer (details in payout_failure). Set by the pay-out job; cleared only by the admin.';
comment on column public.bookings.payout_held_at is 'When the payout was held.';

-- ---------------------------------------------------------------------------
-- 2. DISPUTES
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column stripe_dispute_id text,
  add column disputed_at timestamptz,
  add column dispute_closed_at timestamptz,
  add column dispute_outcome text check (dispute_outcome in ('won', 'lost', 'warning_closed')),
  add constraint bookings_dispute_order check (dispute_closed_at is null or disputed_at is not null);
comment on column public.bookings.disputed_at is
  'When the customer''s bank opened a dispute (chargeback) on this booking''s charge, from Stripe''s webhook. Holds the payout while open.';
comment on column public.bookings.dispute_closed_at is 'When the dispute closed; dispute_outcome says how.';

-- The expire and release jobs' queries: open requests and reservations by time.
create index bookings_open_idx on public.bookings (status, respond_by, reserved_until)
  where status in ('pending_payment', 'requested');

-- ---------------------------------------------------------------------------
-- 3. PAID OUT ONLY WHEN NOTHING HOLDS IT
-- ---------------------------------------------------------------------------

-- bookings_guard: as in booking_requests_answers, plus the paid_out checks.
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
    end if;
  elsif new.starts_at is distinct from old.starts_at or new.payout_due_at is distinct from old.payout_due_at
        or new.confirmed_at is distinct from old.confirmed_at then
    raise exception 'A booking''s time and payout date only change with its status.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
comment on function public.bookings_guard() is
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size and price, follows the allowed status changes, is accepted only before its answer-by time and for a time still ahead, on confirmation gets its end and payout time (24 hours after the end), and is paid out only with a transfer, no hold and no open dispute.';
