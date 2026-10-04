-- Payout holds the admin has released, so the pay-out job doesn't put them
-- straight back (docs/architecture/booking-and-payments.md, Payouts and
-- holds; found 2026-10-04 by supabase/tests/app/payout-holds.test.mts).
--
-- Before: releasing a "refunded" or "provider_suspended" hold ran the job,
-- which saw the same refund or suspension and held the payout again; and a
-- won dispute was held again because the job read Stripe's charge.disputed,
-- which stays true after a dispute is won. The job now judges disputes by
-- the outcome recorded here, and skips a judgement the admin has released.
--
-- 1. booking_finances.payout_holds_released: the hold reasons an admin has
--    released for this booking. Written by the website's server (service
--    role) when the admin releases a hold; it only ever grows.
-- 2. private.booking_records shows and writes it.
--
-- Access: unchanged. booking_finances is read by the booking's provider and
-- admins, written only by the service role.
-- Delete behaviour: unchanged (booking_finances rows are never deleted).

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.booking_finances
  add column payout_holds_released text[] not null default '{}'
    check (payout_holds_released <@ array['problem_reported', 'dispute', 'refunded', 'provider_suspended', 'account_cannot_receive', 'transfer_failed']);
comment on column public.booking_finances.payout_holds_released is
  'Payout hold reasons an admin has released for this booking (release-payout). The pay-out job doesn''t hold the payout again for a released judgement (a lost dispute, a refund, a suspended provider); an open dispute and a reported problem always hold, and a fresh refusal from Stripe holds again. Only grows.';

create or replace function public.booking_finances_released_only_grows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (old.payout_holds_released <@ new.payout_holds_released) then
    raise exception 'A released payout hold can''t be taken back.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.booking_finances_released_only_grows() is
  'Trigger function: booking_finances.payout_holds_released only grows (a release is part of the record).';
revoke all on function public.booking_finances_released_only_grows() from public, anon, authenticated;
create trigger booking_finances_released_only_grows
  before update of payout_holds_released on public.booking_finances
  for each row execute function public.booking_finances_released_only_grows();

-- ---------------------------------------------------------------------------
-- 2. private.booking_records: show it, and write it
-- ---------------------------------------------------------------------------

-- The new column goes last, so the view's existing columns keep their order.
create or replace view private.booking_records with (security_invoker = true) as
select b.*, f.commission_rate_bps, f.commission_cents, f.provider_amount_cents, f.payout_hold, f.payout_held_at, f.payout_failed_at, f.payout_failure, f.stripe_checkout_session_id, f.stripe_payment_intent_id, f.stripe_charge_id, f.stripe_transfer_id, f.stripe_transfer_reversal_id, f.reversal_failed_at, f.reversal_failure, f.stripe_dispute_id, f.disputed_at, f.dispute_closed_at, f.dispute_outcome, f.dispute_reason, f.dispute_amount_cents, f.dispute_evidence_due_by, r.note as problem_note, f.payout_holds_released
  from public.bookings b
  join public.booking_finances f on f.booking_id = b.id
  left join public.booking_reports r on r.booking_id = b.id;
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
revoke all on function private.booking_records_update() from public, anon, authenticated;
