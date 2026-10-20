-- Admin roles, step 5c (docs/design/admin-roles.md, "Customers' contact
-- details" and "Daily limits and alerts"; decided 2026-10-18 and
-- 2026-10-20): contact details only through a recorded view, and
-- support's daily limits.
--
-- 1. Support's daily limits, in admin_settings (the owner's page for them
--    comes in 5d): 5 direct refunds and $500 in all, 40 contact views, 20
--    requests, per person per Atlanta calendar day (the database's clock).
-- 2. Contact details: a customer's email, phone and Service address, and a
--    provider owner's email, only through admin_booking_contact() and
--    admin_provider_contact(), each view recorded in admin_contact_views
--    (append-only). Support may view 40 different bookings or providers a
--    day; the owner has no limit and is recorded too. The admin rules on
--    booking_contacts and booking_addresses go; the lists stop sending
--    addresses (they still match a search by one); the outboxes' to_address
--    is no longer readable through the API.
-- 3. Refunds: the amount each admin refund moved is logged
--    (admin_actions.amount_cents), and support's daily refund limits are
--    checked before Stripe and at the record, as the per-refund limit is.
--    No lock can be held across the Stripe call, so the check before it
--    also reserves the refund (admin_refund_holds), under a per-person
--    lock: refunds started at the same moment queue there, and each sees
--    the others' reservations. The record replaces the reservation; one
--    never completed lapses after 15 minutes.
--    Once a daily refund limit is reached, support may ask the owner for a
--    refund under $150 too.
-- 4. Alerts to every owner, in the bell and by email: each refund or
--    cancellation support makes, and a daily limit reached (once per
--    person, limit and day).

-- ---------------------------------------------------------------------------
-- 1. THE DAILY LIMITS
-- ---------------------------------------------------------------------------

alter table public.admin_settings
  add column support_refunds_per_day integer not null default 5 check (support_refunds_per_day between 0 and 1000),
  add column support_refund_cents_per_day integer not null default 50000 check (support_refund_cents_per_day between 0 and 100000000),
  add column support_contact_views_per_day integer not null default 40 check (support_contact_views_per_day between 0 and 10000),
  add column support_requests_per_day integer not null default 20 check (support_requests_per_day between 0 and 10000);
comment on column public.admin_settings.support_refunds_per_day is 'The most direct refunds or paid cancellations one support member makes in an Atlanta day (default 5).';
comment on column public.admin_settings.support_refund_cents_per_day is 'The most one support member refunds directly in an Atlanta day, in cents (default $500).';
comment on column public.admin_settings.support_contact_views_per_day is 'How many different bookings or providers one support member may see contact details for in an Atlanta day (default 40).';
comment on column public.admin_settings.support_requests_per_day is 'The most requests one support member makes in an Atlanta day (default 20).';

-- The start of today in Atlanta (the home market), as an instant: the
-- daily limits count from here.
create function public.admin_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('day', now() at time zone v.tz)) at time zone v.tz
    from (select coalesce((select timezone from public.cities where slug = 'atlanta'), 'America/New_York') as tz) v;
$$;
comment on function public.admin_day_start() is 'The start of the current Atlanta calendar day, by the database''s clock: when support''s daily limits start counting again.';
revoke execute on function public.admin_day_start() from public, anon, authenticated;

-- The amount each admin refund moved (cents), for the daily refund total.
alter table public.admin_actions add column amount_cents integer check (amount_cents >= 0);
comment on column public.admin_actions.amount_cents is 'For a cancellation or refund by lokl: what that action refunded, in cents (support''s daily refund total adds these up).';

-- The log: limits reached; and the bell and inbox for them and for each
-- refund or cancellation by support.
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded', 'retry_email',
  'suspend_provider', 'reinstate_provider', 'remove_profile_content', 'remove_review', 'restore_review',
  'remove_review_reply', 'restore_review_reply', 'dismiss_review_reports', 'support_reply', 'support_reply_wait',
  'support_move', 'support_note',
  'invite_admin', 'change_admin_role', 'remove_admin', 'reset_admin_mfa', 'join_admin', 'break_glass_owner',
  'request_action', 'decline_request', 'withdraw_request', 'limit_reached'));
alter table public.admin_actions drop constraint admin_actions_reason;
alter table public.admin_actions add constraint admin_actions_reason check (
  action in ('retry_email', 'support_reply', 'support_reply_wait', 'support_move', 'support_note', 'join_admin', 'withdraw_request', 'limit_reached')
  or char_length(trim(reason)) >= 5);
alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check check (kind in (
  'support_new', 'support_safety', 'support_reply', 'team_change', 'request_new', 'request_decided', 'limit_reached', 'support_refund'));
alter table public.admin_notifications drop constraint admin_notifications_about_check;
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  num_nonnulls(report_id, admin_action_id, admin_request_id) = 1
  and (kind in ('support_new', 'support_safety', 'support_reply')) = (report_id is not null)
  and (kind in ('team_change', 'limit_reached', 'support_refund')) = (admin_action_id is not null)
  and (kind in ('request_new', 'request_decided')) = (admin_request_id is not null));
alter table public.admin_emails drop constraint admin_emails_kind_check;
alter table public.admin_emails add constraint admin_emails_kind_check check (kind in (
  'admin_invite', 'admin_team_change', 'admin_request_new', 'admin_limit_reached', 'admin_support_refund'));

-- Every active owner: the bell and an email, about one logged action.
create function public.admin_alert_owners(p_action_id uuid, p_kind text, p_email_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_notifications (recipient_id, kind, admin_action_id)
  select m.user_id, p_kind, p_action_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
  insert into public.admin_emails (kind, admin_action_id, recipient_id)
  select p_email_kind, p_action_id, m.user_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
$$;
comment on function public.admin_alert_owners(uuid, text, text) is 'The limit and refund functions'' own: an alert to every active owner''s bell and inbox about one admin_actions row.';
revoke execute on function public.admin_alert_owners(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. CONTACT VIEWS
-- ---------------------------------------------------------------------------

create table public.admin_contact_views (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete restrict,
  provider_id uuid references public.providers (id) on delete restrict,
  what text not null check (what in ('booking_contact', 'booking_address', 'owner_email')),
  viewed_at timestamptz not null default clock_timestamp(),
  check ((what = 'owner_email') = (provider_id is not null and booking_id is null)),
  check ((what in ('booking_contact', 'booking_address')) = (booking_id is not null and provider_id is null))
);
comment on table public.admin_contact_views is
  'Who saw which contact details, when (admin roles, step 5c): a customer''s email and phone (booking_contact) or Service address (booking_address), or a provider owner''s email (owner_email). Written only by admin_booking_contact() and admin_provider_contact(); append-only, never deleted. The owner reads all of it (the Team page); each admin reads their own (for today''s count).';
create index admin_contact_views_admin_day on public.admin_contact_views (admin_id, viewed_at desc);
create index admin_contact_views_viewed on public.admin_contact_views (viewed_at desc);
create index admin_contact_views_booking on public.admin_contact_views (booking_id) where booking_id is not null;
create index admin_contact_views_provider on public.admin_contact_views (provider_id) where provider_id is not null;
create trigger admin_contact_views_append_only
  before update or delete on public.admin_contact_views
  for each row execute function public.append_only_guard();
create trigger admin_contact_views_append_only_truncate
  before truncate on public.admin_contact_views
  for each statement execute function public.append_only_guard();
alter table public.admin_contact_views enable row level security;
create policy admin_contact_views_read_owner on public.admin_contact_views for select to authenticated
  using ((select public.is_owner()));
comment on policy admin_contact_views_read_owner on public.admin_contact_views is 'The owner reads every contact view.';
create policy admin_contact_views_read_own on public.admin_contact_views for select to authenticated
  using (admin_id = (select auth.uid()) and (select public.is_admin()));
comment on policy admin_contact_views_read_own on public.admin_contact_views is 'Each admin reads their own contact views.';
grant select on public.admin_contact_views to authenticated;

-- Support's refunds in flight: reserved before Stripe (admin_check_refund),
-- replaced by the record (admin_cancel_booking), ignored after 15 minutes.
create table public.admin_refund_holds (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (admin_id, booking_id)
);
comment on table public.admin_refund_holds is
  'Support''s refunds in flight (admin roles, step 5c): reserved before Stripe under a per-person lock and counted in today''s usage, so refunds started at once can''t together pass the daily limits. Deleted when the refund is recorded; ignored after 15 minutes (one never completed lapses) and removed when that person next reserves. Not a log: rows come and go. Only the server writes it; the owner reads it.';
create index admin_refund_holds_admin on public.admin_refund_holds (admin_id, created_at);
alter table public.admin_refund_holds enable row level security;
create policy admin_refund_holds_read_owner on public.admin_refund_holds for select to authenticated
  using ((select public.is_owner()));
comment on policy admin_refund_holds_read_owner on public.admin_refund_holds is 'The owner reads support''s refunds in flight.';
revoke all on public.admin_refund_holds from anon, authenticated;
grant select on public.admin_refund_holds to authenticated;

-- One person's use of their limits today. A refund in flight (a live
-- hold) counts, except the one being recorded (p_except_booking).
create function public.admin_usage_today(p_admin_id uuid, p_except_booking uuid default null)
returns table (refunds integer, refund_cents integer, contact_views integer, requests integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.admin_actions a
      where a.admin_id = p_admin_id and a.action in ('cancel_booking', 'resolve_problem_refunded') and a.request_id is null
        and coalesce(a.amount_cents, 0) > 0 and a.created_at >= public.admin_day_start())
    + (select count(*)::integer from public.admin_refund_holds h
        where h.admin_id = p_admin_id and h.amount_cents > 0 and h.booking_id is distinct from p_except_booking
          and h.created_at >= greatest(now() - interval '15 minutes', public.admin_day_start())),
    (select coalesce(sum(a.amount_cents), 0)::integer from public.admin_actions a
      where a.admin_id = p_admin_id and a.action in ('cancel_booking', 'resolve_problem_refunded') and a.request_id is null
        and a.created_at >= public.admin_day_start())
    + (select coalesce(sum(h.amount_cents), 0)::integer from public.admin_refund_holds h
        where h.admin_id = p_admin_id and h.booking_id is distinct from p_except_booking
          and h.created_at >= greatest(now() - interval '15 minutes', public.admin_day_start())),
    (select count(distinct coalesce(v.booking_id, v.provider_id))::integer from public.admin_contact_views v
      where v.admin_id = p_admin_id and v.viewed_at >= public.admin_day_start()),
    (select count(*)::integer from public.admin_requests r
      where r.requested_by = p_admin_id and r.created_at >= public.admin_day_start());
$$;
comment on function public.admin_usage_today(uuid, uuid) is
  'The limit functions'' own: what one admin has used today (Atlanta day): direct refunds that moved money, and refunds in flight (live holds, but not p_except_booking''s) (count and cents; approved requests don''t count), different bookings or providers whose contact details they saw, and requests made.';
revoke execute on function public.admin_usage_today(uuid, uuid) from public, anon, authenticated;

-- A daily limit reached: logged and every owner told, once per person,
-- limit and day.
create function public.admin_limit_reached(p_admin_id uuid, p_limit text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action uuid;
begin
  if exists (select 1 from public.admin_actions where action = 'limit_reached' and target_id = p_admin_id
              and message = p_limit and created_at >= public.admin_day_start()) then
    return;
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, message)
  values (p_admin_id, 'admin_member', p_admin_id, 'limit_reached', p_limit)
  returning id into v_action;
  perform public.admin_alert_owners(v_action, 'limit_reached', 'admin_limit_reached');
end;
$$;
comment on function public.admin_limit_reached(uuid, text) is
  'The limit functions'' own: logs that a support member reached a daily limit (refunds, refund_cents, contact_views or requests) and tells every owner, once per person, limit and Atlanta day.';
revoke execute on function public.admin_limit_reached(uuid, text) from public, anon, authenticated;

-- Records a contact view, within support's daily limit (a booking or
-- provider already seen today doesn't count again).
create function public.admin_record_contact_view(p_booking_id uuid, p_provider_id uuid, p_whats text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.admin_role();
  v_limit integer := (select support_contact_views_per_day from public.admin_settings where id);
  v_seen boolean;
  v_used integer;
  v_what text;
begin
  if v_role is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'support' then
    -- One at a time per person, so two views at once can't both pass the limit.
    perform pg_advisory_xact_lock(hashtextextended('admin_contact_views:' || v_uid::text, 0));
    v_seen := exists (select 1 from public.admin_contact_views
                       where admin_id = v_uid and viewed_at >= public.admin_day_start()
                         and booking_id is not distinct from p_booking_id and provider_id is not distinct from p_provider_id);
    v_used := (select contact_views from public.admin_usage_today(v_uid));
    if v_seen is not true and coalesce(v_used, 0) >= coalesce(v_limit, 40) then
      raise exception 'You''ve reached today''s limit for contact details (%). Ask the owner.', coalesce(v_limit, 40)
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  foreach v_what in array p_whats loop
    insert into public.admin_contact_views (admin_id, booking_id, provider_id, what) values (v_uid, p_booking_id, p_provider_id, v_what);
  end loop;
  if v_role = 'support' and v_seen is not true and coalesce(v_used, 0) + 1 >= coalesce(v_limit, 40) then
    perform public.admin_limit_reached(v_uid, 'contact_views');
  end if;
end;
$$;
comment on function public.admin_record_contact_view(uuid, uuid, text[]) is 'The contact functions'' own: records a view, refusing support over today''s limit of different bookings or providers.';
revoke execute on function public.admin_record_contact_view(uuid, uuid, text[]) from public, anon, authenticated;

-- A booking's contact details, recorded.
create function public.admin_booking_contact(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.booking_contacts;
  a public.booking_addresses;
begin
  if public.admin_role() is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.bookings where id = p_booking_id) then
    raise exception 'We couldn''t find that booking.' using errcode = 'no_data_found';
  end if;
  select * into c from public.booking_contacts where booking_id = p_booking_id;
  select * into a from public.booking_addresses where booking_id = p_booking_id;
  perform public.admin_record_contact_view(p_booking_id, null,
    case when a.booking_id is null then array['booking_contact'] else array['booking_contact', 'booking_address'] end);
  return jsonb_build_object(
    'email', c.email, 'phone', c.phone,
    'address', case when a.booking_id is null then null else jsonb_build_object(
      'line1', a.line1, 'line2', a.line2, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code, 'instructions', a.instructions) end);
end;
$$;
comment on function public.admin_booking_contact(uuid) is
  'Any admin, through the API: a booking''s customer email, phone and Service address, each view recorded (admin_contact_views); support within today''s limit of different bookings or providers.';
revoke execute on function public.admin_booking_contact(uuid) from public, anon;
grant execute on function public.admin_booking_contact(uuid) to authenticated;

-- A provider owner's email, recorded.
create function public.admin_provider_contact(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if public.admin_role() is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  select u.email into v_email from public.providers p join auth.users u on u.id = p.owner_id where p.id = p_provider_id;
  if not found then
    raise exception 'We couldn''t find that provider.' using errcode = 'no_data_found';
  end if;
  perform public.admin_record_contact_view(null, p_provider_id, array['owner_email']);
  return jsonb_build_object('email', v_email);
end;
$$;
comment on function public.admin_provider_contact(uuid) is
  'Any admin, through the API: a provider owner''s email, the view recorded (admin_contact_views); support within today''s limit of different bookings or providers.';
revoke execute on function public.admin_provider_contact(uuid) from public, anon;
grant execute on function public.admin_provider_contact(uuid) to authenticated;

-- What the pages say: today's use and limits, for the person asking.
create function public.admin_my_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role();
  s public.admin_settings;
  u record;
begin
  if v_role is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.admin_settings where id;
  select * into u from public.admin_usage_today(auth.uid());
  return jsonb_build_object(
    'role', v_role,
    'refund_limit_cents', coalesce(s.refund_limit_cents, 15000),
    'limited', v_role = 'support',
    'refunds', jsonb_build_object('used', u.refunds, 'limit', s.support_refunds_per_day),
    'refund_cents', jsonb_build_object('used', u.refund_cents, 'limit', s.support_refund_cents_per_day),
    'contact_views', jsonb_build_object('used', u.contact_views, 'limit', s.support_contact_views_per_day),
    'requests', jsonb_build_object('used', u.requests, 'limit', s.support_requests_per_day));
end;
$$;
comment on function public.admin_my_limits() is
  'Any admin: their own use of today''s limits (Atlanta day) and the limits themselves; `limited` says whether they apply (support) or not (the owner).';
revoke execute on function public.admin_my_limits() from public, anon;
grant execute on function public.admin_my_limits() to authenticated;

-- The Team page's record: who saw what, newest first, paged; the owner only.
create function public.admin_contact_views_page(p_admin_id uuid default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_rows jsonb;
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can see the record of contact views.' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_total from public.admin_contact_views v where p_admin_id is null or v.admin_id = p_admin_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'viewed_at', v.viewed_at, 'what', v.what,
           'admin_id', v.admin_id, 'admin_email', (select u.email from auth.users u where u.id = v.admin_id),
           'booking', (select jsonb_build_object('id', b.id, 'listing_title', l.title, 'starts_at', b.starts_at, 'customer_name', b.customer_name)
                         from public.bookings b join public.listings l on l.id = b.listing_id where b.id = v.booking_id),
           'provider', (select jsonb_build_object('id', p.id, 'name', p.display_name) from public.providers p where p.id = v.provider_id)
         ) order by v.viewed_at desc), '[]'::jsonb)
    into v_rows
    from (select * from public.admin_contact_views
           where p_admin_id is null or admin_id = p_admin_id
           order by viewed_at desc limit v_size offset (v_page - 1) * v_size) v;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end;
$$;
comment on function public.admin_contact_views_page(uuid, integer, integer) is
  'The owner only: the record of contact views, newest first, paged, optionally for one team member: who, when, what, and which booking or provider (never the details themselves).';
revoke execute on function public.admin_contact_views_page(uuid, integer, integer) from public, anon;
grant execute on function public.admin_contact_views_page(uuid, integer, integer) to authenticated;

-- Contact details no longer reach admins through the tables.
drop policy booking_contacts_read_admin on public.booking_contacts;
drop policy booking_addresses_read_admin on public.booking_addresses;

-- The outboxes: every column but the address they went to.
revoke select on public.booking_emails, public.provider_emails, public.support_emails, public.admin_emails from authenticated;
grant select (id, booking_id, kind, recipient, status, attempts, next_attempt_at, locked_at, sent_at, resend_id, last_error, skip_reason, created_at)
  on public.booking_emails to authenticated;
grant select (id, provider_id, admin_action_id, kind, message, status, attempts, next_attempt_at, locked_at, sent_at, resend_id, last_error, skip_reason, created_at, removed, rule)
  on public.provider_emails to authenticated;
grant select (id, report_id, kind, provider_id, admin_id, status, attempts, next_attempt_at, locked_at, sent_at, resend_id, last_error, skip_reason, created_at)
  on public.support_emails to authenticated;
grant select (id, kind, admin_action_id, recipient_id, status, attempts, next_attempt_at, locked_at, sent_at, resend_id, last_error, skip_reason, created_at)
  on public.admin_emails to authenticated;

-- ---------------------------------------------------------------------------
-- 3. REFUNDS: THE DAILY LIMITS, THE AMOUNT, THE ALERTS
-- ---------------------------------------------------------------------------

-- Why a refund of p_cents now would go past one of today's refund limits
-- for this person, or null if it wouldn't. One rule for the three places
-- that ask: before Stripe, at the record, and whether support may ask
-- the owner instead.
create function public.admin_daily_refund_refusal(p_admin_id uuid, p_cents integer, p_booking_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.admin_settings;
  u record;
begin
  if coalesce(p_cents, 0) <= 0 then
    return null;
  end if;
  select * into s from public.admin_settings where id;
  -- This booking's own hold (a retry, or its record) isn't counted against it.
  select * into u from public.admin_usage_today(p_admin_id, p_booking_id);
  if coalesce(u.refunds, 0) >= coalesce(s.support_refunds_per_day, 5) then
    return format('You''ve reached today''s limit of %s refunds. Ask the owner with "Request a refund".', coalesce(s.support_refunds_per_day, 5));
  end if;
  if coalesce(u.refund_cents, 0) + p_cents > coalesce(s.support_refund_cents_per_day, 50000) then
    return format('This refund would take you past today''s %s for refunds (%s so far). Ask the owner with "Request a refund".',
      public.admin_money(coalesce(s.support_refund_cents_per_day, 50000)), public.admin_money(coalesce(u.refund_cents, 0)));
  end if;
  return null;
end;
$$;
comment on function public.admin_daily_refund_refusal(uuid, integer, uuid) is
  'The refund functions'' own: why refunding p_cents of p_booking_id now would go past today''s refund count or total for this person (support), counting their refunds in flight but not this booking''s own, or null.';
revoke execute on function public.admin_daily_refund_refusal(uuid, integer, uuid) from public, anon, authenticated;

-- A refund that didn't happen at Stripe (Stripe refused it, or it failed
-- before reaching Stripe): its hold goes at once, so it doesn't count
-- toward today's limits for 15 minutes. Not when the outcome is unknown
-- (no answer): the money may have moved, and the hold stands until the
-- record or the 15 minutes.
create function public.admin_release_refund_hold(p_admin_id uuid, p_booking_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.admin_refund_holds where admin_id = p_admin_id and booking_id = p_booking_id;
$$;
comment on function public.admin_release_refund_hold(uuid, uuid) is
  'Server only: releases a support member''s hold on a refund that Stripe refused or that never reached Stripe, so it stops counting toward today''s limits.';
revoke execute on function public.admin_release_refund_hold(uuid, uuid) from public, anon, authenticated;

-- admin_check_refund: from 20261020000245_admin_requests.sql, with the daily limits.

CREATE OR REPLACE FUNCTION public.admin_check_refund(p_admin_id uuid, p_booking_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_role = 'support' and v_cents > 0 then
    -- One at a time per person until this transaction ends: refunds started
    -- at once queue here, and each sees the others' holds.
    perform pg_advisory_xact_lock(hashtextextended('admin_refunds:' || p_admin_id::text, 0));
    if public.admin_daily_refund_refusal(p_admin_id, v_cents, p_booking_id) is not null then
      raise exception '%', public.admin_daily_refund_refusal(p_admin_id, v_cents, p_booking_id) using errcode = 'insufficient_privilege';
    end if;
    -- Reserved: counted in today's usage until recorded, or for 15 minutes.
    delete from public.admin_refund_holds where admin_id = p_admin_id and created_at < now() - interval '15 minutes';
    insert into public.admin_refund_holds (admin_id, booking_id, amount_cents) values (p_admin_id, p_booking_id, v_cents)
    on conflict (admin_id, booking_id) do update set amount_cents = excluded.amount_cents, created_at = clock_timestamp();
  end if;
  return v_cents;
end;
$function$;

comment on function public.admin_check_refund(uuid, uuid) is
  'Server only, before Stripe: the refund this booking would get now (what''s left of the charge), refused for support above the refund limit or past today''s refund count or total; for support, reserved (admin_refund_holds) under a per-person lock until recorded or for 15 minutes.';

-- admin_cancel_booking: from 20261020014749_null_safe_guards.sql, with the
-- daily limits, the amount logged, and support's refunds told to the owners.

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
  v_amount integer;
  v_logged uuid;
  u record;
  s public.admin_settings;
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
  -- Today's refund limits too, on the same terms.
  if v_role is not distinct from 'support' and coalesce(p_refunded_cents, 0) <= v_before
     and public.admin_daily_refund_refusal(p_admin_id, coalesce(public.admin_refundable_cents(p_booking_id), 0), p_booking_id) is not null then
    raise exception '%', public.admin_daily_refund_refusal(p_admin_id, coalesce(public.admin_refundable_cents(p_booking_id), 0), p_booking_id)
      using errcode = 'insufficient_privilege';
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
    -- Already recorded (a retry, a lost reply finished, or the other way):
    -- the refund counts once, through its log, so its hold goes now.
    delete from public.admin_refund_holds where booking_id = p_booking_id and admin_id = p_admin_id;
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
  v_amount := case when coalesce(p_refunded_cents, 0) > v_before then p_refunded_cents - v_before end;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, request_id, amount_cents)
  values (p_admin_id, 'booking', p_booking_id, v_action, p_reason, v_request, v_amount)
  returning id into v_logged;
  -- The record replaces the refund's hold.
  delete from public.admin_refund_holds where booking_id = p_booking_id and admin_id = p_admin_id;
  -- Support's own refunds and cancellations (not an approved request):
  -- every owner told, each its own; and a daily limit now reached.
  if v_request is null and coalesce(v_role, (select m.role from public.admin_members m where m.user_id = p_admin_id)) = 'support' then
    perform public.admin_alert_owners(v_logged, 'support_refund', 'admin_support_refund');
    select * into u from public.admin_usage_today(p_admin_id);
    select * into s from public.admin_settings where id;
    if coalesce(u.refunds, 0) >= coalesce(s.support_refunds_per_day, 5) then
      perform public.admin_limit_reached(p_admin_id, 'refunds');
    end if;
    if coalesce(u.refund_cents, 0) >= coalesce(s.support_refund_cents_per_day, 50000) then
      perform public.admin_limit_reached(p_admin_id, 'refund_cents');
    end if;
  end if;
  return 'cancelled';
end;
$function$;

comment on function public.admin_cancel_booking(uuid, uuid, text, text, boolean, integer, timestamptz, text, text, uuid) is
  'Server only: records lokl''s cancellation (and refund) of a booking with its admin log (and the amount it refunded), after Stripe. Support above the refund limit or past today''s refund limits is refused (before Stripe, by admin_check_refund; here unless this action''s Stripe effect has already happened). Support''s own refunds and cancellations are told to every owner. With p_request_id, the owner approving that request, which closes with it, also when a lost reply is finished from Stripe''s metadata (admin_request_id); the owner acting directly closes a matching request as done by the owner.';

-- admin_request_create: from 20261020000245_admin_requests.sql, with the
-- request limit, and refunds under the limit once today's refund limits are reached.

CREATE OR REPLACE FUNCTION public.admin_request_create(p_kind text, p_booking_id uuid, p_provider_id uuid, p_reason text, p_message text DEFAULT NULL::text, p_resolve_problem boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if coalesce((select r.requests from public.admin_usage_today(v_uid) r), 0)
     >= coalesce((select support_requests_per_day from public.admin_settings where id), 20) then
    raise exception 'You''ve reached today''s limit of % requests. Talk to the owner.',
      coalesce((select support_requests_per_day from public.admin_settings where id), 20) using errcode = 'insufficient_privilege';
  end if;

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
      -- Within the limit, support refunds it themselves, unless today's refund limits are reached.
      if v_amount <= v_limit and public.admin_daily_refund_refusal(v_uid, v_amount, p_booking_id) is null then
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
  if coalesce((select r.requests from public.admin_usage_today(v_uid) r), 0)
     >= coalesce((select support_requests_per_day from public.admin_settings where id), 20) then
    perform public.admin_limit_reached(v_uid, 'requests');
  end if;
  return v_id;
end;
$function$;

comment on function public.admin_request_create(text, uuid, uuid, text, text, boolean) is
  'Support, through the API: asks the owner to do what only the owner may (a refund over the limit, or any refund once today''s refund limits are reached; a payout release; resolving a report by paying the provider; a suspension or reinstatement), with a reason, within today''s request limit. Refuses the owner, a thing in the wrong state, and a second pending request for the same thing. Logged; every owner told (bell and email).';

-- ---------------------------------------------------------------------------
-- 4. THE LISTS STOP SENDING ADDRESSES
-- ---------------------------------------------------------------------------

-- admin_bookings_page: from 20261004043455_admin_dashboard.sql, without
-- customer_email (a search by email still matches).

CREATE OR REPLACE FUNCTION public.admin_bookings_page(p_q text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_provider_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_attention text DEFAULT NULL::text, p_sort text DEFAULT 'created'::text, p_desc boolean DEFAULT true, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_with_attention boolean DEFAULT false, p_paid_from date DEFAULT NULL::date, p_paid_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- The "needs attention" groups, written once: the counts and the filter use these.
  c_attention constant jsonb := jsonb_build_object(
    'reports', 'b.problem_reported_at is not null and b.problem_resolution is null and b.status <> ''cancelled''',
    'holds', 'f.payout_hold is not null and f.payout_hold <> ''problem_reported'' and b.status not in (''paid_out'', ''cancelled'')',
    'owed', 'f.reversal_failed_at is not null',
    'disputes', 'f.disputed_at is not null and f.dispute_closed_at is null',
    'unavailable', 'b.status = ''confirmed'' and (l.status <> ''live'' or p.status = ''suspended'')'
  );
  c_sorts constant jsonb := jsonb_build_object(
    'created', 'b.created_at',
    'when', 'coalesce(b.starts_at, b.created_at)',
    'status', 'b.status',
    'listing', 'l.title',
    -- Money columns sort by what was charged; never-charged bookings count as -1.
    'charged', 'case when b.confirmed_at is not null then b.total_cents else -1 end',
    'commission', 'case when b.confirmed_at is not null then f.commission_cents else -1 end',
    'provider_amount', 'case when b.confirmed_at is not null then f.provider_amount_cents else -1 end'
  );
  v_from constant text := '
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    join public.providers p on p.id = b.provider_id
    left join public.cities c on c.id = l.city_id
    left join public.booking_finances f on f.booking_id = b.id
    left join public.booking_contacts bc on bc.booking_id = b.id';
  v_where text := ' where b.status <> ''pending_payment''';
  v_patterns text[] := public.admin_search_patterns(p_q);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_cents integer;
  v_total bigint;
  v_rows jsonb;
  v_counts jsonb;
  v_totals jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if not c_sorts ? coalesce(p_sort, '') then
    raise exception 'Unknown sort: %', p_sort using errcode = 'invalid_parameter_value';
  end if;
  if p_attention is not null and not c_attention ? p_attention then
    raise exception 'Unknown attention group: %', p_attention using errcode = 'invalid_parameter_value';
  end if;

  -- Each word matches the customer's name or email, the listing's title, the
  -- provider's name, or (a number like 45 or $45.00) the amount charged.
  for i in 1 .. coalesce(array_length(v_patterns, 1), 0) loop
    v_cents := null;
    if trim(both '%' from v_patterns[i]) ~ '^\$?[0-9]+(\.[0-9]{1,2})?$' then
      v_cents := round(ltrim(trim(both '%' from v_patterns[i]), '$')::numeric * 100);
    end if;
    -- One id lookup per field, joined with UNION, so each can use its own
    -- index (trigram on name and email, the listing and provider indexes).
    v_where := v_where || format('
      and b.id in (
        select x.id from public.bookings x where x.customer_name ilike $1[%1$s]
        union select x.booking_id from public.booking_contacts x where x.email ilike $1[%1$s]
        union select x.id from public.bookings x
          where x.listing_id in (select y.id from public.listings y where y.title ilike $1[%1$s])
        union select x.id from public.bookings x
          where x.provider_id in (select y.id from public.providers y where y.display_name ilike $1[%1$s])%2$s)',
      i, case when v_cents is not null then format('
        union select x.id from public.bookings x where x.total_cents = %s', v_cents) else '' end);
  end loop;
  if p_status is not null then v_where := v_where || ' and b.status = $2'; end if;
  if p_kind is not null then v_where := v_where || ' and b.kind = $3'; end if;
  if p_provider_id is not null then v_where := v_where || ' and b.provider_id = $4'; end if;
  -- Calendar days in the booking's market time zone; the outer bounds (a day
  -- either side) let the index on coalesce(starts_at, created_at) narrow first.
  if p_from is not null then
    v_where := v_where || ' and coalesce(b.starts_at, b.created_at) >= ($5::date - 1)::timestamptz
      and (coalesce(b.starts_at, b.created_at) at time zone coalesce(c.timezone, ''America/New_York''))::date >= $5';
  end if;
  if p_to is not null then
    v_where := v_where || ' and coalesce(b.starts_at, b.created_at) < ($6::date + 2)::timestamptz
      and (coalesce(b.starts_at, b.created_at) at time zone coalesce(c.timezone, ''America/New_York''))::date <= $6';
  end if;
  if p_attention is not null then v_where := v_where || ' and (' || (c_attention ->> p_attention) || ')'; end if;
  -- Paid between (the dashboard's money cards): the calendar day, in the
  -- booking's market time zone, its payment was recorded (confirmed_at: an
  -- Experience at checkout, a Service when the provider accepted). The outer
  -- bounds (a day either side) narrow by the timestamp first.
  if p_paid_from is not null then
    v_where := v_where || ' and b.confirmed_at >= ($7::date - 1)::timestamptz
      and (b.confirmed_at at time zone coalesce(c.timezone, ''America/New_York''))::date >= $7';
  end if;
  if p_paid_to is not null then
    v_where := v_where || ' and b.confirmed_at < ($8::date + 2)::timestamptz
      and (b.confirmed_at at time zone coalesce(c.timezone, ''America/New_York''))::date <= $8';
  end if;

  -- The matches are found once, for both the total and the page. Only their
  -- ids and sort keys are sorted and cut to the page; the JSON is built for
  -- the page's rows only.
  execute format($q$
    with matched as materialized (
      select b.id, %3$s as s, b.confirmed_at is not null as charged, b.total_cents, b.refunded_cents, f.commission_cents
      %1$s %2$s
    ), page as (
      select x.id, row_number() over (order by x.s %4$s nulls last, x.id %4$s) as n
      from (select id, s from matched order by s %4$s nulls last, id %4$s limit %5$s offset %6$s) x
    )
    select (select count(*) from matched),
    -- The money across every match (not just this page), as the table shows
    -- it: only bookings that were charged; no commission kept on a booking
    -- refunded in full.
    (select jsonb_build_object(
        'charged_count', count(*) filter (where charged),
        'charged_cents', coalesce(sum(total_cents) filter (where charged), 0),
        'refunded_cents', coalesce(sum(refunded_cents) filter (where charged), 0),
        'commission_cents', coalesce(sum(case when refunded_cents >= total_cents then 0 else commission_cents end) filter (where charged), 0))
      from matched),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'status', b.status, 'listing_id', b.listing_id, 'provider_id', b.provider_id,
        'starts_at', b.starts_at, 'ends_at', b.ends_at, 'created_at', b.created_at, 'party_size', b.party_size,
        'total_cents', b.total_cents, 'refunded_cents', b.refunded_cents, 'cancelled_by', b.cancelled_by,
        'confirmed_at', b.confirmed_at, 'payout_due_at', b.payout_due_at, 'problem_reported_at', b.problem_reported_at,
        'problem_resolution', b.problem_resolution, 'customer_name', b.customer_name,
        'commission_cents', f.commission_cents, 'provider_amount_cents', f.provider_amount_cents,
        'payout_hold', f.payout_hold, 'payout_failure', f.payout_failure, 'stripe_transfer_id', f.stripe_transfer_id,
        'disputed_at', f.disputed_at, 'dispute_closed_at', f.dispute_closed_at, 'dispute_outcome', f.dispute_outcome,
        'reversal_failed_at', f.reversal_failed_at,
        'listing', jsonb_build_object('title', l.title, 'kind', l.kind, 'status', l.status,
          'city', case when c.id is null then null else jsonb_build_object('name', c.name, 'timezone', c.timezone) end),
        'provider', jsonb_build_object('display_name', p.display_name, 'status', p.status)
      ) order by page.n), '[]'::jsonb)
    %1$s
    join page on page.id = b.id)
  $q$, v_from, v_where, c_sorts ->> p_sort, case when p_desc then 'desc' else 'asc' end, v_size, (v_page - 1) * v_size)
    into v_total, v_totals, v_rows using v_patterns, p_status, p_kind, p_provider_id, p_from, p_to, p_paid_from, p_paid_to;

  -- The "needs attention" counts across every booking, not this page.
  if p_with_attention then
    execute 'select jsonb_build_object(' ||
      (select string_agg(format('%L, count(*) filter (where %s)', k, v), ', ') from jsonb_each_text(c_attention) as a(k, v)) ||
      ')' || v_from || ' where b.status <> ''pending_payment'''
      into v_counts;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'total_exact', true, 'totals', v_totals, 'attention', v_counts);
end;
$function$;


-- admin_providers_page: from 20261004043455_admin_dashboard.sql, without
-- owner_email (a search by it still matches; admin_provider_contact shows it, recorded).

CREATE OR REPLACE FUNCTION public.admin_providers_page(p_q text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_payout_setup text DEFAULT NULL::text, p_city_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'joined'::text, p_desc boolean DEFAULT true, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_paid_since date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_sorts constant jsonb := jsonb_build_object(
    'joined', 'p.created_at', 'name', 'p.display_name', 'status', 'p.status', 'city', 'c.name',
    'payouts', 'public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled)'
  );
  v_from constant text := '
    from public.providers p
    join auth.users u on u.id = p.owner_id
    left join public.cities c on c.id = p.city_id';
  v_where text := ' where true';
  v_patterns text[] := public.admin_search_patterns(p_q);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_rows jsonb;
begin
  -- This function reads auth.users: this check is what keeps owners' emails private.
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if not c_sorts ? coalesce(p_sort, '') then
    raise exception 'Unknown sort: %', p_sort using errcode = 'invalid_parameter_value';
  end if;
  if p_payout_setup is not null and p_payout_setup not in ('not_started', 'in_progress', 'ready', 'not_ready') then
    raise exception 'Unknown payout setup: %', p_payout_setup using errcode = 'invalid_parameter_value';
  end if;

  -- Each word matches the business name or the owner's email.
  for i in 1 .. coalesce(array_length(v_patterns, 1), 0) loop
    v_where := v_where || format(' and (p.display_name ilike $1[%1$s] or u.email ilike $1[%1$s])', i);
  end loop;
  if p_status is not null then v_where := v_where || ' and p.status = $2'; end if;
  -- not_ready: can't be paid yet (setup not started or still in progress).
  if p_payout_setup = 'not_ready' then
    v_where := v_where || ' and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) <> ''ready''';
  elsif p_payout_setup is not null then
    v_where := v_where || ' and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) = $3';
  end if;
  -- At least one booking paid on or after this day (in the booking's market
  -- time zone): the dashboard's active providers.
  if p_paid_since is not null then
    v_where := v_where || ' and exists (
      select 1 from public.bookings x
        join public.listings xl on xl.id = x.listing_id
        left join public.cities xc on xc.id = xl.city_id
      where x.provider_id = p.id and x.confirmed_at >= ($5::date - 1)::timestamptz
        and (x.confirmed_at at time zone coalesce(xc.timezone, ''America/New_York''))::date >= $5)';
  end if;
  if p_city_id is not null then v_where := v_where || ' and p.city_id = $4'; end if;

  -- As for bookings: match once, sort and cut the ids, then build the page's JSON.
  execute format($q$
    with matched as materialized (
      select p.id, %3$s as s %1$s %2$s
    ), page as (
      select x.id, row_number() over (order by x.s %4$s nulls last, x.id %4$s) as n
      from (select id, s from matched order by s %4$s nulls last, id %4$s limit %5$s offset %6$s) x
    )
    -- Only what the page shows: never the Stripe account id or the owner's id.
    select (select count(*) from matched), (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'status', p.status, 'created_at', p.created_at,
        'payout_setup', public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled),
        'city', case when c.id is null then null else jsonb_build_object('name', c.name, 'state', c.state) end
      ) order by page.n), '[]'::jsonb)
    %1$s
    join page on page.id = p.id)
  $q$, v_from, v_where, c_sorts ->> p_sort, case when p_desc then 'desc' else 'asc' end, v_size, (v_page - 1) * v_size)
    into v_total, v_rows using v_patterns, p_status, p_payout_setup, p_city_id, p_paid_since;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'total_exact', true);
end;
$function$;

comment on function public.admin_bookings_page(text, text, text, uuid, date, date, text, text, boolean, integer, integer, boolean, date, date) is
  'Admins only: one page of bookings (not pending payment) for the admin Bookings table, filtered by search text (customer name or email, listing title, provider name, or an amount), status, kind, provider, a date range (when it takes place) or a paid range (when it was paid; both in the market''s time zone) and a "needs attention" group; with the total, the money totals across every match (charged, refunded, commission kept) and, if asked, the attention counts across all bookings. Sends no contact details (since step 5c; a search by email still matches): admin_booking_contact shows them, recorded.';
comment on function public.admin_providers_page(text, text, text, uuid, text, boolean, integer, integer, date) is
  'Admins only: one page of providers with their market and payout setup, filtered by search text (business name or owner email: matched, never sent), status, payout setup and market; with the total. Also the provider pickers'' server-side search. The owner''s email is shown by admin_provider_contact, recorded (step 5c).';
