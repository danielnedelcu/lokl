-- Null-safe refusals (2026-10-20; scripts/check-null-guards.mjs): a
-- comparison that can be null skips an `if`, so a refusal written as
-- `if not v_owner` or `if v_role = 'support'` would let a null through.
-- These three in admin_cancel_booking were safe only because of lines
-- elsewhere (v_finishing and v_owner are never null; v_role is null only
-- when finishing a refund Stripe already made). They now say so
-- themselves: `is not true`, `is not distinct from`. Same behaviour.
-- check:null-guards fails on any new refusal or role test a null could skip.

-- admin_cancel_booking: from 20261020000245_admin_requests.sql, three conditions only.
CREATE OR REPLACE FUNCTION public.admin_cancel_booking(p_booking_id uuid, p_admin_id uuid, p_reason text, p_from text, p_resolve_problem boolean, p_refunded_cents integer, p_cancelled_at timestamp with time zone, p_reversal_id text, p_reversal_failure text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_action text := case when p_resolve_problem then 'resolve_problem_refunded' else 'cancel_booking' end;
  v_role text := public.admin_role_of(p_admin_id);
  v_finishing boolean := v_role is null and public.admin_finishing_stripe(p_admin_id);
  -- The owner, or (finishing a refund Stripe already made, with no admin
  -- session) an admin who is on the team as an owner.
  v_owner boolean;
  v_status text;
  v_by text;
  v_resolution text;
  v_before integer;
  v_moved boolean;
  v_request uuid;
begin
  if v_role is null and v_finishing is not true then
    raise exception 'Only an admin can cancel a booking this way.' using errcode = 'insufficient_privilege';
  end if;
  v_owner := coalesce(v_role = 'owner', false)
    or (v_finishing and exists (select 1 from public.admin_members where user_id = p_admin_id and role = 'owner'));
  if p_request_id is not null and v_owner is not true then
    raise exception 'Only the owner can approve a request.' using errcode = 'insufficient_privilege';
  end if;
  select status, cancelled_by, problem_resolution into v_status, v_by, v_resolution
    from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'No such booking.' using errcode = 'no_data_found';
  end if;
  -- What had been refunded before this action (p_refunded_cents is the
  -- charge's total refunded, earlier partial refunds included).
  select coalesce(refunded_cents, 0) into v_before from private.booking_records where id = p_booking_id;
  -- Support above the limit: refused before Stripe (admin_check_refund),
  -- and here unless this action's refund has already happened (more is
  -- refunded than before): then the money has moved and the record follows.
  if v_role is not distinct from 'support' and coalesce(p_refunded_cents, 0) <= v_before
     and coalesce(public.admin_refundable_cents(p_booking_id), 0) > public.admin_refund_limit_cents() then
    raise exception 'This refund is over the limit support can refund. Ask the owner with "Request a refund".' using errcode = 'insufficient_privilege';
  end if;
  -- This action's money has moved (more refunded than before, a transfer
  -- reversal made or attempted, or finishing from Stripe): from here
  -- nothing about a request may block the record.
  v_moved := coalesce(p_refunded_cents, 0) > v_before or p_reversal_id is not null or p_reversal_failure is not null or v_finishing;
  -- Before money moves, approving needs the request still waiting.
  if p_request_id is not null and not v_moved and not exists (
       select 1 from public.admin_requests where id = p_request_id and status = 'pending') then
    raise exception 'That request isn''t waiting for a decision any more.' using errcode = 'check_violation';
  end if;
  if v_status = 'cancelled' and v_by = 'admin' then
    -- Done already only if it was this action: a report resolved with a
    -- refund for p_resolve_problem, a plain cancel otherwise.
    if p_resolve_problem is distinct from (v_resolution is not distinct from 'refunded') then
      return 'changed';
    end if;
    if exists (select 1 from public.admin_actions
               where target = 'booking' and target_id = p_booking_id and action = v_action) then
      -- A request approved again after a lost reply: close it now (the
      -- money moved earlier, so this never refuses).
      perform public.admin_cancel_settle(p_request_id, false, true, p_admin_id, p_booking_id, p_resolve_problem, 'Already cancelled and refunded.');
      return 'already cancelled';
    end if;
    v_request := public.admin_cancel_settle(p_request_id, v_owner, v_moved, p_admin_id, p_booking_id, p_resolve_problem, 'Cancelled and refunded.');
    insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id)
    values (p_admin_id, 'booking', p_booking_id, v_action, p_reason, v_request);
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
  v_request := public.admin_cancel_settle(p_request_id, v_owner, v_moved, p_admin_id, p_booking_id, p_resolve_problem,
    case when coalesce(p_refunded_cents, 0) > v_before then 'Cancelled and refunded ' || public.admin_money(p_refunded_cents - v_before) || '.' else 'Cancelled.' end);
  insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id)
  values (p_admin_id, 'booking', p_booking_id, v_action, p_reason, v_request);
  return 'cancelled';
end;
$function$;
