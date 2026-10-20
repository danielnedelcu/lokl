-- Admin roles, step 5b (docs/design/admin-roles.md; decided 2026-10-18 and
-- 2026-10-19): support asks, the owner approves.
--
-- 1. The refund limit (admin_settings, one row: $150; the owner's page for
--    it comes in 5d). Support refunds directly up to the limit, measured
--    on what's left of the charge (total less what's been refunded), not
--    the booking's total. Cancelling a booking request (a card hold, no
--    money moved) stays direct.
-- 2. Requests (admin_requests): a refund over the limit, releasing a payout
--    hold, resolving a report by paying the provider, suspending or
--    reinstating a provider. Support asks with a reason; the owner
--    approves (the website runs the same action, as the owner, and the
--    action's own function closes the request in the same transaction) or
--    declines with a note; the person who asked can withdraw it. Pending
--    for 7 days at most. The owner doing the same thing directly closes
--    a matching request as "done by the owner".
-- 3. The gate: the four action functions refuse support where a request is
--    needed. A refund goes to Stripe before its record, so the website asks
--    admin_check_refund() first; admin_cancel_booking doesn't refuse once
--    Stripe has refunded (the money has moved; the record must follow).
-- 4. The record: every action done on a request carries its request
--    (admin_actions.request_id), so a booking's or provider's history names
--    the person who asked and the owner who approved (admin_member_names()).
--    New requests go to every owner's bell and inbox; decisions to the
--    asker's bell.

-- ---------------------------------------------------------------------------
-- 1. THE REFUND LIMIT
-- ---------------------------------------------------------------------------

create table public.admin_settings (
  id boolean primary key default true check (id),
  refund_limit_cents integer not null default 15000 check (refund_limit_cents between 0 and 1000000),
  updated_at timestamptz not null default now()
);
comment on table public.admin_settings is
  'The owner''s settings for the team (admin roles): one row (id is always true). Support refunds directly up to refund_limit_cents of what''s left of a charge; above it, they ask the owner (admin_requests). Never deleted. Changed by the owner from the Settings page (step 5d); until then, by migration.';
comment on column public.admin_settings.refund_limit_cents is 'The most support can refund directly, in cents, measured on what''s left of the charge (default $150).';
insert into public.admin_settings default values;
create trigger admin_settings_set_updated_at before update on public.admin_settings
  for each row execute function public.set_updated_at();
alter table public.admin_settings enable row level security;
create policy admin_settings_read_admin on public.admin_settings for select to authenticated
  using ((select public.is_admin()));
comment on policy admin_settings_read_admin on public.admin_settings is 'Every admin reads the settings (the pages say when a refund needs the owner).';
grant select on public.admin_settings to authenticated;

create function public.admin_refund_limit_cents()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select refund_limit_cents from public.admin_settings where id), 15000);
$$;
comment on function public.admin_refund_limit_cents() is 'The refund limit for support, in cents (admin_settings).';
revoke execute on function public.admin_refund_limit_cents() from public, anon, authenticated;

-- What a refund of this booking would be now: what's left of the charge. A
-- booking request (a card hold) or an unpaid booking refunds nothing.
create function public.admin_refundable_cents(p_booking_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when b.status in ('confirmed', 'completed', 'paid_out') then greatest(b.total_cents - coalesce(b.refunded_cents, 0), 0) else 0 end
    from private.booking_records b where b.id = p_booking_id;
$$;
comment on function public.admin_refundable_cents(uuid) is 'What refunding this booking would refund now: its total less what has been refunded, for a paid booking; 0 otherwise.';
revoke execute on function public.admin_refundable_cents(uuid) from public, anon, authenticated;

-- "$1,234.50", for refusals and the owners' email.
create function public.admin_money(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(coalesce(p_cents, 0) / 100.0, 'FM$999,999,990.00');
$$;
comment on function public.admin_money(integer) is 'Cents as dollars for messages: "$1,234.50".';
revoke execute on function public.admin_money(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. REQUESTS
-- ---------------------------------------------------------------------------

create table public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'release_payout', 'resolve_problem_paid', 'suspend_provider', 'reinstate_provider')),
  booking_id uuid references public.bookings (id) on delete restrict,
  provider_id uuid references public.providers (id) on delete restrict,
  -- A refund that resolves a no-show report (resolve_problem_refunded).
  resolve_problem boolean not null default false,
  -- When asked: the refund (what was left of the charge) and the hold.
  amount_cents integer check (amount_cents >= 0),
  hold text,
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  -- Suspending or reinstating: lokl's optional words to the provider, for their email.
  message text check (char_length(message) <= 1000),
  requested_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn', 'expired', 'done_by_owner')),
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 1000),
  result text check (char_length(result) <= 300),
  check ((kind in ('suspend_provider', 'reinstate_provider')) = (provider_id is not null and booking_id is null)),
  check ((kind in ('refund', 'release_payout', 'resolve_problem_paid')) = (booking_id is not null and provider_id is null)),
  check (resolve_problem = false or kind = 'refund'),
  check ((kind = 'refund') = (amount_cents is not null)),
  check ((kind = 'release_payout') = (hold is not null)),
  check (message is null or kind in ('suspend_provider', 'reinstate_provider')),
  check ((status = 'pending') = (decided_at is null))
);
comment on table public.admin_requests is
  'Support''s requests for what only the owner may do (admin roles, step 5b): a refund over the limit, releasing a payout hold, resolving a report by paying the provider, suspending or reinstating a provider. Pending until the owner approves (the action runs, as the owner, and closes it), declines (with a note) or acts directly ("done by the owner"), the asker withdraws it, or 7 days pass (expired). One pending request per thing. Never deleted; only its decision is ever written, once.';
comment on column public.admin_requests.amount_cents is 'A refund''s amount when asked: what was left of the charge then. Approving refunds what''s left at that moment, which the approval screen shows if it changed.';
comment on column public.admin_requests.hold is 'The payout hold to release, as it was when asked.';
comment on column public.admin_requests.result is 'What approving (or the owner''s own action) did, in a few words.';
create unique index admin_requests_one_pending on public.admin_requests (kind, coalesce(booking_id, provider_id)) where status = 'pending';
create index admin_requests_pending on public.admin_requests (created_at) where status = 'pending';
create index admin_requests_requested_by on public.admin_requests (requested_by, created_at desc);
create index admin_requests_booking on public.admin_requests (booking_id) where booking_id is not null;
create index admin_requests_provider on public.admin_requests (provider_id) where provider_id is not null;

-- Only the decision is written, once; never deleted (the server key included).
create function public.admin_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Requests are never deleted.' using errcode = 'check_violation';
  end if;
  if old.status <> 'pending'
     or (new.id, new.kind, new.booking_id, new.provider_id, new.resolve_problem, new.amount_cents, new.hold, new.reason, new.message, new.requested_by, new.created_at)
        is distinct from (old.id, old.kind, old.booking_id, old.provider_id, old.resolve_problem, old.amount_cents, old.hold, old.reason, old.message, old.requested_by, old.created_at) then
    raise exception 'A request''s decision is written once, and nothing else about it changes.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.admin_requests_guard() is 'Trigger: a request is never deleted, and only a pending one gets its decision.';
revoke execute on function public.admin_requests_guard() from public, anon, authenticated, service_role;
create trigger admin_requests_guard before update or delete on public.admin_requests
  for each row execute function public.admin_requests_guard();
create trigger admin_requests_guard_truncate before truncate on public.admin_requests
  for each statement execute function public.admin_requests_guard();

alter table public.admin_requests enable row level security;
create policy admin_requests_read_owner on public.admin_requests for select to authenticated
  using ((select public.is_owner()));
comment on policy admin_requests_read_owner on public.admin_requests is 'The owner reads every request.';
create policy admin_requests_read_own on public.admin_requests for select to authenticated
  using (requested_by = (select auth.uid()) and (select public.is_admin()));
comment on policy admin_requests_read_own on public.admin_requests is 'Support reads the requests they made.';
grant select on public.admin_requests to authenticated;

-- The log: requests and their decisions, and which request an action ran on.
alter table public.admin_actions add column request_id uuid references public.admin_requests (id) on delete restrict;
comment on column public.admin_actions.request_id is 'The request this action answered: approved (the action ran, as the owner) or done by the owner directly. With admin_requests.requested_by, the history names who asked and who approved.';
create index admin_actions_request on public.admin_actions (request_id) where request_id is not null;
alter table public.admin_actions drop constraint admin_actions_target_check;
alter table public.admin_actions add constraint admin_actions_target_check check (target in (
  'booking', 'provider', 'email', 'review', 'support_report', 'admin_member', 'admin_request'));
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded', 'retry_email',
  'suspend_provider', 'reinstate_provider', 'remove_profile_content', 'remove_review', 'restore_review',
  'remove_review_reply', 'restore_review_reply', 'dismiss_review_reports', 'support_reply', 'support_reply_wait',
  'support_move', 'support_note',
  'invite_admin', 'change_admin_role', 'remove_admin', 'reset_admin_mfa', 'join_admin', 'break_glass_owner',
  'request_action', 'decline_request', 'withdraw_request'));
alter table public.admin_actions drop constraint admin_actions_reason;
alter table public.admin_actions add constraint admin_actions_reason check (
  action in ('retry_email', 'support_reply', 'support_reply_wait', 'support_move', 'support_note', 'join_admin', 'withdraw_request')
  or char_length(trim(reason)) >= 5);

-- The bell: a new request (every owner), a decision (the person who asked).
alter table public.admin_notifications add column admin_request_id uuid references public.admin_requests (id) on delete restrict;
comment on column public.admin_notifications.admin_request_id is 'For a request: the request (request_new to each owner; request_decided to the person who asked).';
create index admin_notifications_admin_request on public.admin_notifications (admin_request_id) where admin_request_id is not null;
alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check
  check (kind in ('support_new', 'support_safety', 'support_reply', 'team_change', 'request_new', 'request_decided'));
alter table public.admin_notifications drop constraint admin_notifications_about_check;
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  num_nonnulls(report_id, admin_action_id, admin_request_id) = 1
  and (kind in ('support_new', 'support_safety', 'support_reply')) = (report_id is not null)
  and (kind = 'team_change') = (admin_action_id is not null)
  and (kind in ('request_new', 'request_decided')) = (admin_request_id is not null));

-- The owners' email for a new request (never the reason).
alter table public.admin_emails drop constraint admin_emails_kind_check;
alter table public.admin_emails add constraint admin_emails_kind_check check (kind in ('admin_invite', 'admin_team_change', 'admin_request_new'));

-- ---------------------------------------------------------------------------
-- 3. THE REQUEST FUNCTIONS
-- ---------------------------------------------------------------------------

-- Pending requests older than 7 days lapse. Called before a request is
-- made or decided, so the one-pending rule never counts a lapsed one.
create function public.admin_requests_expire()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.admin_requests set status = 'expired', decided_at = now(), result = 'Not decided within 7 days.'
   where status = 'pending' and created_at <= now() - interval '7 days';
$$;
comment on function public.admin_requests_expire() is 'The request functions'' own: marks pending requests older than 7 days expired.';
revoke execute on function public.admin_requests_expire() from public, anon, authenticated;

-- A decision, in the asker's bell.
create function public.admin_request_tell_asker(p_request_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_notifications (recipient_id, kind, admin_request_id)
  select r.requested_by, 'request_decided', r.id from public.admin_requests r where r.id = p_request_id;
$$;
comment on function public.admin_request_tell_asker(uuid) is 'The request functions'' own: the decision goes to the bell of the person who asked.';
revoke execute on function public.admin_request_tell_asker(uuid) from public, anon, authenticated;

-- Closes the request an action answers, in the action's own transaction:
-- with p_request_id, approving that request (which must still be pending,
-- for this thing); without, the owner doing it directly closes a matching
-- pending request as done by the owner. Returns the request's id, or null.
create function public.admin_request_settle(
  p_request_id uuid, p_admin_id uuid, p_kind text, p_booking_id uuid, p_provider_id uuid, p_resolve_problem boolean, p_result text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_request_id is not null then
    update public.admin_requests set status = 'approved', decided_by = p_admin_id, decided_at = now(), result = left(p_result, 300)
     where id = p_request_id and status = 'pending' and kind = p_kind
       and booking_id is not distinct from p_booking_id and provider_id is not distinct from p_provider_id
       and resolve_problem = coalesce(p_resolve_problem, false)
    returning id into v_id;
    if v_id is null then
      raise exception 'That request isn''t waiting for a decision any more.' using errcode = 'check_violation';
    end if;
  else
    update public.admin_requests set status = 'done_by_owner', decided_by = p_admin_id, decided_at = now(), result = left(p_result, 300)
     where status = 'pending' and kind = p_kind
       and booking_id is not distinct from p_booking_id and provider_id is not distinct from p_provider_id
       and (p_kind <> 'refund' or resolve_problem = coalesce(p_resolve_problem, false))
    returning id into v_id;
  end if;
  if v_id is not null then
    perform public.admin_request_tell_asker(v_id);
  end if;
  return v_id;
end;
$$;
comment on function public.admin_request_settle(uuid, uuid, text, uuid, uuid, boolean, text) is
  'The action functions'' own: approving a request closes it with what was done; the owner acting directly closes a matching pending request as done by the owner. The asker is told either way.';
revoke execute on function public.admin_request_settle(uuid, uuid, text, uuid, uuid, boolean, text) from public, anon, authenticated;

-- The server, before a refund goes to Stripe: refuses support above the
-- limit, on what's left of the charge now.
create function public.admin_check_refund(p_admin_id uuid, p_booking_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role_of(p_admin_id);
  v_cents integer := coalesce(public.admin_refundable_cents(p_booking_id), 0);
  v_limit integer := public.admin_refund_limit_cents();
begin
  if v_role is null then
    raise exception 'Only an admin can cancel a booking this way.' using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'support' and v_cents > v_limit then
    raise exception 'This refund is %, over the % support can refund. Ask the owner with "Request a refund".',
      public.admin_money(v_cents), public.admin_money(v_limit) using errcode = 'insufficient_privilege';
  end if;
  return v_cents;
end;
$$;
comment on function public.admin_check_refund(uuid, uuid) is
  'Server only, before Stripe: the refund this booking would get now (what''s left of the charge), refused for support above the refund limit.';
revoke execute on function public.admin_check_refund(uuid, uuid) from public, anon, authenticated;

-- Support asks. Through the API, as themselves.
create function public.admin_request_create(
  p_kind text, p_booking_id uuid, p_provider_id uuid, p_reason text, p_message text default null, p_resolve_problem boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.admin_role();
  v_b record;
  v_status text;
  v_amount integer;
  v_hold text;
  v_limit integer := public.admin_refund_limit_cents();
  v_id uuid;
  v_action uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_role is null then
    raise exception 'Only an admin can make a request.' using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'owner' then
    raise exception 'You''re the owner: do it directly.' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Say why, in a few words.' using errcode = 'check_violation';
  end if;
  if p_kind not in ('refund', 'release_payout', 'resolve_problem_paid', 'suspend_provider', 'reinstate_provider') then
    raise exception 'That isn''t something to request.' using errcode = 'check_violation';
  end if;
  if v_message is not null and p_kind not in ('suspend_provider', 'reinstate_provider') then
    raise exception 'A message to the provider goes with a suspension or reinstatement only.' using errcode = 'check_violation';
  end if;
  perform public.admin_requests_expire();

  if p_kind in ('suspend_provider', 'reinstate_provider') then
    select status into v_status from public.providers where id = p_provider_id;
    if not found then
      raise exception 'We couldn''t find that provider.' using errcode = 'no_data_found';
    end if;
    if p_kind = 'suspend_provider' and v_status = 'suspended' then
      raise exception 'This provider is already suspended.' using errcode = 'check_violation';
    end if;
    if p_kind = 'reinstate_provider' and v_status = 'active' then
      raise exception 'This provider is already active.' using errcode = 'check_violation';
    end if;
  else
    select status, payout_hold, problem_reported_at, problem_resolution, disputed_at, dispute_closed_at
      into v_b from private.booking_records where id = p_booking_id;
    if not found then
      raise exception 'We couldn''t find that booking.' using errcode = 'no_data_found';
    end if;
    if p_kind = 'refund' then
      if coalesce(p_resolve_problem, false) and (v_b.problem_reported_at is null or v_b.problem_resolution is not null) then
        raise exception 'There''s no open report on this booking.' using errcode = 'check_violation';
      end if;
      if v_b.status not in ('confirmed', 'completed', 'paid_out') then
        raise exception 'Only a paid booking is refunded.' using errcode = 'check_violation';
      end if;
      v_amount := public.admin_refundable_cents(p_booking_id);
      if v_amount <= v_limit then
        raise exception 'This refund is %, within the % you can refund: do it directly.', public.admin_money(v_amount), public.admin_money(v_limit)
          using errcode = 'check_violation';
      end if;
    elsif p_kind = 'release_payout' then
      if v_b.payout_hold is null then
        raise exception 'This payout isn''t held.' using errcode = 'check_violation';
      end if;
      if v_b.payout_hold = 'problem_reported' then
        raise exception 'A customer reported a problem: ask to resolve the report instead.' using errcode = 'check_violation';
      end if;
      if v_b.disputed_at is not null and v_b.dispute_closed_at is null then
        raise exception 'The dispute is still open, so the payout stays held.' using errcode = 'check_violation';
      end if;
      v_hold := v_b.payout_hold;
    else
      if v_b.problem_reported_at is null or v_b.problem_resolution is not null then
        raise exception 'There''s no open report on this booking.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  begin
    insert into public.admin_requests (kind, booking_id, provider_id, resolve_problem, amount_cents, hold, reason, message, requested_by)
    values (p_kind,
            case when p_kind in ('suspend_provider', 'reinstate_provider') then null else p_booking_id end,
            case when p_kind in ('suspend_provider', 'reinstate_provider') then p_provider_id end,
            p_kind = 'refund' and coalesce(p_resolve_problem, false), v_amount,
            v_hold,
            v_reason, v_message, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There''s already a request waiting for this.' using errcode = 'check_violation';
  end;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id)
  values (v_uid, 'admin_request', v_id, 'request_action', v_reason, v_id)
  returning id into v_action;
  insert into public.admin_notifications (recipient_id, kind, admin_request_id)
  select m.user_id, 'request_new', v_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
  insert into public.admin_emails (kind, admin_action_id, recipient_id)
  select 'admin_request_new', v_action, m.user_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
  return v_id;
end;
$$;
comment on function public.admin_request_create(text, uuid, uuid, text, text, boolean) is
  'Support, through the API: asks the owner to do what only the owner may (a refund over the limit, a payout release, resolving a report by paying the provider, a suspension or reinstatement), with a reason. Refuses the owner (they act directly), a refund support may make, a thing in the wrong state, and a second pending request for the same thing. Logged; every owner told (bell and email).';
revoke execute on function public.admin_request_create(text, uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_request_create(text, uuid, uuid, text, text, boolean) to authenticated;

create function public.admin_request_withdraw(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.admin_role() is null then
    raise exception 'Only an admin can withdraw a request.' using errcode = 'insufficient_privilege';
  end if;
  perform public.admin_requests_expire();
  update public.admin_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id and requested_by = auth.uid() and status = 'pending'
  returning id into v_id;
  if v_id is null then
    raise exception 'You have no request waiting with that id.' using errcode = 'no_data_found';
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, request_id)
  values (auth.uid(), 'admin_request', v_id, 'withdraw_request', v_id);
  return 'withdrawn';
end;
$$;
comment on function public.admin_request_withdraw(uuid) is 'The person who asked, through the API: withdraws their pending request. Logged.';
revoke execute on function public.admin_request_withdraw(uuid) from public, anon;
grant execute on function public.admin_request_withdraw(uuid) to authenticated;

create function public.admin_request_decline(p_request_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can decline a request.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_note) < 5 then
    raise exception 'Say why, in a few words. They''ll see it.' using errcode = 'check_violation';
  end if;
  perform public.admin_requests_expire();
  update public.admin_requests set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = left(v_note, 1000)
   where id = p_request_id and status = 'pending'
  returning id into v_id;
  if v_id is null then
    raise exception 'That request isn''t waiting for a decision any more.' using errcode = 'check_violation';
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id)
  values (auth.uid(), 'admin_request', v_id, 'decline_request', v_note, v_id);
  perform public.admin_request_tell_asker(v_id);
  return 'declined';
end;
$$;
comment on function public.admin_request_decline(uuid, text) is 'The owner, through the API: declines a pending request with a note the asker sees. Logged; the asker is told.';
revoke execute on function public.admin_request_decline(uuid, text) from public, anon;
grant execute on function public.admin_request_decline(uuid, text) to authenticated;

-- The website, approving: what to run. Marks a lapsed request expired.
create function public.admin_request_for_approval(p_admin_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.admin_requests;
begin
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Only the owner can approve a request.' using errcode = 'insufficient_privilege';
  end if;
  perform public.admin_requests_expire();
  select * into r from public.admin_requests where id = p_request_id;
  if not found then
    raise exception 'We couldn''t find that request.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'booking_id', r.booking_id, 'provider_id', r.provider_id,
    'resolve_problem', r.resolve_problem, 'reason', r.reason, 'message', r.message, 'hold', r.hold,
    'amount_cents', r.amount_cents,
    'current_amount_cents', case when r.kind = 'refund' then public.admin_refundable_cents(r.booking_id) end,
    'result', r.result);
end;
$$;
comment on function public.admin_request_for_approval(uuid, uuid) is
  'Server only, as the owner: a request''s details for approving it, with a refund''s amount now; lapsed requests are marked expired first.';
revoke execute on function public.admin_request_for_approval(uuid, uuid) from public, anon, authenticated;

-- The Requests page: waiting (open) or decided (closed), paged. The owner
-- sees everyone's; support their own. A refund shows its amount when asked
-- and now. Who asked and who decided, by email (team members only).
create function public.admin_requests_page(p_scope text default 'open', p_page integer default 1, p_page_size integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role();
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_open bigint;
  v_rows jsonb;
begin
  if v_role is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_scope, 'open') not in ('open', 'closed') then
    raise exception 'Unknown list: %', p_scope using errcode = 'invalid_parameter_value';
  end if;
  with mine as (
    select r.*, (r.status = 'pending' and r.created_at > now() - interval '7 days') as waiting
      from public.admin_requests r
     where v_role = 'owner' or r.requested_by = auth.uid()
  ), picked as (
    select * from mine where waiting = (coalesce(p_scope, 'open') = 'open')
  ), page as (
    select * from picked
     order by case when coalesce(p_scope, 'open') = 'open' then created_at end asc,
              case when coalesce(p_scope, 'open') = 'closed' then coalesce(decided_at, created_at + interval '7 days') end desc
     limit v_size offset (v_page - 1) * v_size
  )
  select (select count(*) from picked), (select count(*) from mine where waiting),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'kind', p.kind, 'resolve_problem', p.resolve_problem,
           'status', case when p.status = 'pending' and not p.waiting then 'expired' else p.status end,
           'created_at', p.created_at, 'expires_at', p.created_at + interval '7 days',
           'reason', p.reason, 'message', p.message, 'hold', p.hold,
           'amount_cents', p.amount_cents,
           'current_amount_cents', case when p.kind = 'refund' then public.admin_refundable_cents(p.booking_id) end,
           'requested_by', p.requested_by,
           'requested_by_email', (select u.email from auth.users u where u.id = p.requested_by),
           'decided_by_email', (select u.email from auth.users u where u.id = p.decided_by),
           'decided_at', p.decided_at, 'decision_note', p.decision_note, 'result', p.result,
           'booking', (select jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'status', b.status, 'payout_hold', b.payout_hold,
                                                 'listing_title', l.title, 'provider_name', pv.display_name,
                                                 'market_name', c.name, 'timezone', c.timezone)
                         from private.booking_records b
                         join public.listings l on l.id = b.listing_id
                         join public.providers pv on pv.id = b.provider_id
                         join public.cities c on c.id = l.city_id
                        where b.id = p.booking_id),
           'provider', (select jsonb_build_object('id', pv.id, 'name', pv.display_name, 'status', pv.status)
                          from public.providers pv where pv.id = p.provider_id)
         ) order by case when coalesce(p_scope, 'open') = 'open' then p.created_at end asc,
                    case when coalesce(p_scope, 'open') = 'closed' then coalesce(p.decided_at, p.created_at + interval '7 days') end desc), '[]'::jsonb)
    into v_total, v_open, v_rows
    from page p;
  return jsonb_build_object('total', v_total, 'open_total', v_open, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end;
$$;
comment on function public.admin_requests_page(text, integer, integer) is
  'The Requests page, paged: waiting (open, oldest first) or decided (closed, newest first; a pending one past 7 days shows as expired). The owner sees every request, support their own. No customer details.';
revoke execute on function public.admin_requests_page(text, integer, integer) from public, anon;
grant execute on function public.admin_requests_page(text, integer, integer) to authenticated;

-- Team members' emails by id, for a history line ("asked by …, approved by …").
create function public.admin_member_names(p_ids uuid[])
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.admin_role() is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.user_id, u.email::text
    from public.admin_members m join auth.users u on u.id = m.user_id
   where m.user_id = any(p_ids[1:200]); -- bounded: the ids asked for, at most 200
end;
$$;
comment on function public.admin_member_names(uuid[]) is 'Any admin: team members'' emails for the ids given (at most 200), for naming who did what in a history. Never anyone outside the team.';
revoke execute on function public.admin_member_names(uuid[]) from public, anon;
grant execute on function public.admin_member_names(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE ACTIONS: THE GATE, AND CLOSING REQUESTS
-- ---------------------------------------------------------------------------
-- Each takes p_request_id (the request it approves, or null). Redefined
-- from 20261018194929_admin_members.sql (admin_cancel_booking from
-- 20261011024704_money_lost_replies.sql through it): a new argument, so
-- dropped and made again, with the same grants (the server only).

-- admin_cancel_booking's request, once its booking is recorded. Before
-- money moves, as the other actions: approving needs the request still
-- pending (or the record is refused). After Stripe has refunded, closing
-- the request never blocks the record: approved if still pending;
-- otherwise (withdrawn, expired, decided meanwhile) left as it is, its id
-- kept on the admin action. Without a request, the owner acting directly
-- closes a matching one as done by the owner.
create function public.admin_cancel_settle(
  p_request_id uuid, p_owner boolean, p_moved boolean, p_admin_id uuid, p_booking_id uuid, p_resolve_problem boolean, p_result text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_request_id is not null and p_moved then
    -- One update that does nothing if the request is no longer pending: a
    -- withdrawal or expiry at the same instant holds the row, and this
    -- update re-reads it once that commits, so there's no gap between a
    -- check and the close, and nothing here can refuse.
    update public.admin_requests set status = 'approved', decided_by = p_admin_id, decided_at = now(), result = left(p_result, 300)
     where id = p_request_id and status = 'pending' and kind = 'refund' and booking_id = p_booking_id
       and resolve_problem = coalesce(p_resolve_problem, false)
    returning id into v_id;
    if v_id is not null then
      perform public.admin_request_tell_asker(v_id);
    end if;
    return p_request_id;
  end if;
  if p_owner or p_request_id is not null then
    return public.admin_request_settle(p_request_id, p_admin_id, 'refund', p_booking_id, null, p_resolve_problem, p_result);
  end if;
  return null;
end;
$$;
comment on function public.admin_cancel_settle(uuid, boolean, boolean, uuid, uuid, boolean, text) is
  'admin_cancel_booking''s own: closes the refund request it answers. Once Stripe has refunded, never refuses: a request no longer pending is left as it is, and its id returned for the admin action.';
revoke execute on function public.admin_cancel_settle(uuid, boolean, boolean, uuid, uuid, boolean, text) from public, anon, authenticated;

drop function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text);
create function public.admin_cancel_booking(
  p_booking_id uuid, p_admin_id uuid, p_reason text, p_from text, p_resolve_problem boolean,
  p_refunded_cents integer, p_cancelled_at timestamptz, p_reversal_id text, p_reversal_failure text,
  p_request_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_role is null and not v_finishing then
    raise exception 'Only an admin can cancel a booking this way.' using errcode = 'insufficient_privilege';
  end if;
  v_owner := coalesce(v_role = 'owner', false)
    or (v_finishing and exists (select 1 from public.admin_members where user_id = p_admin_id and role = 'owner'));
  if p_request_id is not null and not v_owner then
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
  if v_role = 'support' and coalesce(p_refunded_cents, 0) <= v_before
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
$$;
comment on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text, uuid) is
  'Server only: records lokl''s cancellation (and refund) of a booking with its admin log, after Stripe. Support above the refund limit is refused (before Stripe, by admin_check_refund; here unless this action''s refund has already happened). With p_request_id, the owner approving that request, which closes with it, also when a lost reply is finished from Stripe''s metadata (admin_request_id); the owner acting directly closes a matching request as done by the owner.';
revoke execute on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text, uuid) to service_role;

drop function public.admin_release_payout(uuid, uuid, text, text);
create function public.admin_release_payout(p_booking_id uuid, p_admin_id uuid, p_reason text, p_hold text, p_request_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role_of(p_admin_id);
  v_request uuid;
begin
  if v_role is null then
    raise exception 'Only an admin can release a payout.' using errcode = 'insufficient_privilege';
  end if;
  if v_role <> 'owner' then
    raise exception 'Releasing a payout needs the owner. Ask with "Request a release".' using errcode = 'insufficient_privilege';
  end if;
  update private.booking_records set
    payout_hold = null, payout_held_at = null,
    payout_holds_released = array(select distinct h from unnest(coalesce(payout_holds_released, '{}') || p_hold) h order by h)
  where id = p_booking_id and payout_hold = p_hold;
  if not found then
    if p_request_id is not null then
      perform public.admin_request_settle(p_request_id, p_admin_id, 'release_payout', p_booking_id, null, false, 'Nothing was held any more.');
    end if;
    return false;
  end if;
  v_request := public.admin_request_settle(p_request_id, p_admin_id, 'release_payout', p_booking_id, null, false, 'Payout released.');
  insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id)
  values (p_admin_id, 'booking', p_booking_id, 'release_payout', p_reason, v_request);
  return true;
end;
$$;
comment on function public.admin_release_payout(uuid, uuid, text, text, uuid) is
  'Server only, the owner: releases a booking''s payout hold, logged. Support asks instead (admin_request_create). With p_request_id, approving that request.';
revoke execute on function public.admin_release_payout(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_release_payout(uuid, uuid, text, text, uuid) to service_role;

drop function public.admin_resolve_problem_paid(uuid, uuid, text);
create function public.admin_resolve_problem_paid(p_booking_id uuid, p_admin_id uuid, p_reason text, p_request_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role_of(p_admin_id);
  v_request uuid;
begin
  if v_role is null then
    raise exception 'Only an admin can resolve a report.' using errcode = 'insufficient_privilege';
  end if;
  if v_role <> 'owner' then
    raise exception 'Paying the provider on a report needs the owner. Ask with "Request to pay the provider".' using errcode = 'insufficient_privilege';
  end if;
  update private.booking_records set
    problem_resolution = 'paid_provider', problem_resolved_at = now(),
    payout_held_at = case when payout_hold = 'problem_reported' then null else payout_held_at end,
    payout_hold = case when payout_hold = 'problem_reported' then null else payout_hold end
  where id = p_booking_id and problem_reported_at is not null and problem_resolution is null;
  if not found then
    if p_request_id is not null then
      perform public.admin_request_settle(p_request_id, p_admin_id, 'resolve_problem_paid', p_booking_id, null, false, 'The report was already resolved.');
    end if;
    return false;
  end if;
  v_request := public.admin_request_settle(p_request_id, p_admin_id, 'resolve_problem_paid', p_booking_id, null, false, 'Report resolved: the provider is paid.');
  insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id)
  values (p_admin_id, 'booking', p_booking_id, 'resolve_problem_paid', p_reason, v_request);
  return true;
end;
$$;
comment on function public.admin_resolve_problem_paid(uuid, uuid, text, uuid) is
  'Server only, the owner: resolves a no-show report in the provider''s favour, logged. Support asks instead. With p_request_id, approving that request.';
revoke execute on function public.admin_resolve_problem_paid(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_resolve_problem_paid(uuid, uuid, text, uuid) to service_role;

drop function public.admin_set_provider_status(uuid, text, uuid, text, text);
create function public.admin_set_provider_status(
  p_provider_id uuid, p_status text, p_admin_id uuid, p_reason text, p_message text, p_request_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role_of(p_admin_id);
  v_kind text := case when p_status = 'suspended' then 'suspend_provider' else 'reinstate_provider' end;
  v_action uuid;
  v_request uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  -- Only the website's server calls this, after checking the admin. As a
  -- second line of defence, the id it passes must be the owner's.
  if v_role is null then
    raise exception 'Only an admin can suspend or reinstate a provider.' using errcode = 'insufficient_privilege';
  end if;
  if v_role <> 'owner' then
    raise exception 'Suspending or reinstating a provider needs the owner. Ask with "Request".' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'A provider is active or suspended.' using errcode = 'check_violation';
  end if;
  update public.providers set status = p_status where id = p_provider_id and status <> p_status;
  if not found then
    if not exists (select 1 from public.providers where id = p_provider_id) then
      raise exception 'No such provider.' using errcode = 'no_data_found';
    end if;
    if p_request_id is not null then
      perform public.admin_request_settle(p_request_id, p_admin_id, v_kind, null, p_provider_id, false,
        case when p_status = 'suspended' then 'Already suspended.' else 'Already active.' end);
    end if;
    return false;
  end if;
  v_request := public.admin_request_settle(p_request_id, p_admin_id, v_kind, null, p_provider_id, false,
    case when p_status = 'suspended' then 'Suspended.' else 'Reinstated.' end);
  insert into public.admin_actions (admin_id, target, target_id, action, reason, message, request_id)
  values (p_admin_id, 'provider', p_provider_id, v_kind, p_reason, v_message, v_request)
  returning id into v_action;
  insert into public.provider_emails (provider_id, admin_action_id, kind, message)
  values (p_provider_id, v_action,
          case when p_status = 'suspended' then 'provider_account_paused' else 'provider_account_active' end,
          v_message);
  return true;
end;
$$;
comment on function public.admin_set_provider_status(uuid, text, uuid, text, text, uuid) is
  'Server only, the owner: suspends or reinstates a provider, logged, with their email. Support asks instead. With p_request_id, approving that request.';
revoke execute on function public.admin_set_provider_status(uuid, text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_provider_status(uuid, text, uuid, text, text, uuid) to service_role;
