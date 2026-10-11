-- Money actions whose reply was lost (the lost-reply check, decided
-- 2026-10-11). Stripe may have captured or refunded when lokl's write never
-- happened; a retry, Stripe's webhook or the expiry job finishes the action
-- later, so the rules must judge it by when Stripe acted, not by now.
--
-- 1. bookings_guard: an accept may carry the time Stripe captured the card
--    (confirmed_at, between the request and now), and the answer-by check
--    uses it; a cancellation's policy (the start, the 48-hour line, the
--    1-hour grace) goes by cancelled_at, which the server may set to the
--    time Stripe refunded (between the booking and now; never later than
--    now). Everything else is unchanged.
-- 2. Three admin money actions, each one function, so the booking change
--    and its admin_actions row are written together or not at all
--    ("money writes in one transaction", for these): cancel or refund,
--    release a payout hold, and resolve a no-show report in the provider's
--    favour. The Stripe step comes first, in the website's server; these
--    record it. Server only (service_role), and the admin id must be an
--    admin's. A retry of a finished cancel answers success, and writes the
--    log if an earlier attempt didn't.

-- ---------------------------------------------------------------------------
-- 1. bookings_guard
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
      if new.kind = 'service' and not (new.starts_at = any (new.preferred_times)) then
        raise exception 'Accept one of the times the customer offered.' using errcode = 'check_violation';
      end if;
      v_duration := make_interval(mins => coalesce(v_listing.duration_minutes, 0));
      new.confirmed_at := coalesce(v_accepted_at, now());
      new.ends_at := new.starts_at + v_duration;
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
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size and price, follows the allowed status changes, is accepted only before its answer-by time (judged at confirmed_at when the server passes the time Stripe captured the card) and for a time still ahead, gets its end and payout time (24 hours after the end) on confirmation, and is cancelled under the policy as of cancelled_at (now, or the time Stripe refunded).';

-- ---------------------------------------------------------------------------
-- 2. Admin money actions
-- ---------------------------------------------------------------------------

-- Cancel (or refund a no-show report): records what the server already did
-- in Stripe (the refund, the transfer reversal or its failure) with the
-- booking cancelled by lokl, and the admin action, together.
-- Returns 'cancelled'; 'already cancelled' (by lokl, by this same action,
-- and logged); 'logged' (cancelled by lokl by this same action, but an
-- earlier attempt's log is written now); or 'changed' (the booking moved on
-- from p_from, or lokl cancelled it by the other action).
create function public.admin_cancel_booking(
  p_booking_id uuid, p_admin_id uuid, p_reason text, p_from text, p_resolve_problem boolean,
  p_refunded_cents integer, p_cancelled_at timestamptz, p_reversal_id text, p_reversal_failure text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := case when p_resolve_problem then 'resolve_problem_refunded' else 'cancel_booking' end;
  v_status text;
  v_by text;
  v_resolution text;
begin
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Only an admin can cancel a booking this way.' using errcode = 'insufficient_privilege';
  end if;
  select status, cancelled_by, problem_resolution into v_status, v_by, v_resolution
    from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'No such booking.' using errcode = 'no_data_found';
  end if;
  if v_status = 'cancelled' and v_by = 'admin' then
    -- Done already only if it was this action: a report resolved with a
    -- refund for p_resolve_problem, a plain cancel otherwise.
    if p_resolve_problem is distinct from (v_resolution is not distinct from 'refunded') then
      return 'changed';
    end if;
    if exists (select 1 from public.admin_actions
               where target = 'booking' and target_id = p_booking_id and action = v_action) then
      return 'already cancelled';
    end if;
    insert into public.admin_actions (admin_id, target, target_id, action, reason)
    values (p_admin_id, 'booking', p_booking_id, v_action, p_reason);
    return 'logged';
  end if;
  update private.booking_records set
    status = 'cancelled', cancelled_by = 'admin', cancel_reason = p_reason, status_changed_by = 'admin',
    cancelled_at = p_cancelled_at,
    refunded_cents = greatest(refunded_cents, coalesce(p_refunded_cents, 0)),
    refunded_at = case when coalesce(p_refunded_cents, 0) > refunded_cents then coalesce(p_cancelled_at, now()) else refunded_at end,
    stripe_transfer_reversal_id = coalesce(p_reversal_id, stripe_transfer_reversal_id),
    reversal_failed_at = case when p_reversal_failure is not null then now() else reversal_failed_at end,
    reversal_failure = coalesce(p_reversal_failure, reversal_failure),
    problem_resolution = case when p_resolve_problem then 'refunded' else problem_resolution end,
    problem_resolved_at = case when p_resolve_problem then now() else problem_resolved_at end
  where id = p_booking_id and status = p_from;
  if not found then
    return 'changed';
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (p_admin_id, 'booking', p_booking_id, v_action, p_reason);
  return 'cancelled';
end;
$$;
comment on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text) is
  'Server only: records lokl cancelling a booking (or resolving a no-show report with a refund) after the Stripe step, with the admin action, in one transaction. A retry of a finished cancel answers ''already cancelled'', writing the log if it''s missing. Refuses an admin id that isn''t an admin''s.';
revoke execute on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text) to service_role;

-- Release a payout hold, remembering it was released (payout_holds_released),
-- with the admin action. False when that hold is no longer on the booking.
create function public.admin_release_payout(p_booking_id uuid, p_admin_id uuid, p_reason text, p_hold text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Only an admin can release a payout.' using errcode = 'insufficient_privilege';
  end if;
  update private.booking_records set
    payout_hold = null, payout_held_at = null,
    payout_holds_released = array(select distinct h from unnest(coalesce(payout_holds_released, '{}') || p_hold) h order by h)
  where id = p_booking_id and payout_hold = p_hold;
  if not found then
    return false;
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (p_admin_id, 'booking', p_booking_id, 'release_payout', p_reason);
  return true;
end;
$$;
comment on function public.admin_release_payout(uuid, uuid, text, text) is
  'Server only: clears a payout hold, remembers it was released, and logs the admin action, in one transaction. False when that hold is no longer on the booking. Refuses an admin id that isn''t an admin''s.';
revoke execute on function public.admin_release_payout(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_release_payout(uuid, uuid, text, text) to service_role;

-- Resolve a no-show report in the provider's favour (the payout goes ahead),
-- with the admin action. False when the report is already resolved.
create function public.admin_resolve_problem_paid(p_booking_id uuid, p_admin_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Only an admin can resolve a report.' using errcode = 'insufficient_privilege';
  end if;
  update private.booking_records set
    problem_resolution = 'paid_provider', problem_resolved_at = now(),
    payout_held_at = case when payout_hold = 'problem_reported' then null else payout_held_at end,
    payout_hold = case when payout_hold = 'problem_reported' then null else payout_hold end
  where id = p_booking_id and problem_reported_at is not null and problem_resolution is null;
  if not found then
    return false;
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (p_admin_id, 'booking', p_booking_id, 'resolve_problem_paid', p_reason);
  return true;
end;
$$;
comment on function public.admin_resolve_problem_paid(uuid, uuid, text) is
  'Server only: resolves a no-show report in the provider''s favour (clearing its payout hold) and logs the admin action, in one transaction. False when the report is already resolved. Refuses an admin id that isn''t an admin''s.';
revoke execute on function public.admin_resolve_problem_paid(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_problem_paid(uuid, uuid, text) to service_role;
