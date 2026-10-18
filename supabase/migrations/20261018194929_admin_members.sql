-- Admin roles, read live, and the second factor required (docs/design/
-- admin-roles.md, cutover step 4; approved 2026-10-18).
--
-- Today an admin is anyone whose sign-in token says app_metadata.role =
-- 'admin', granted by hand in SQL. From here:
-- - admin_members holds each person's role (owner, support) and status
--   (invited, active, removed), read on every request, so a change takes
--   effect at once, not when a token expires. Seeded from today's admins,
--   as active owners.
-- - admin_role() is the caller's role: an active member whose session is
--   still current in auth.sessions and has passed the second factor
--   (aal2). is_admin(), used by every admin access rule, becomes
--   "admin_role() is not null"; is_owner() is new.
-- - The server-only admin functions (refunds, payouts, suspensions,
--   moderation, support, guides) check admin_role_of(p_admin_id): the
--   same, for the session the website's server names in the request header
--   x-lokl-admin-session, and only when the caller is the server
--   (service_role), so the header can never be trusted from a browser,
--   even if a function's permissions were widened by mistake.
-- - Never deleted; at least one active owner, always; an admin login never
--   owns a business, read from admin_members both ways.
-- - admin_role_preview() tells the signed-in person what the switch makes
--   of them, for the cutover's check.
-- Permissions finer than "an active admin" (support's limits, requests)
-- come with the Team page (cutover step 5): until then every member is an
-- owner.

-- ---------------------------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------------------------

create table public.admin_members (
  user_id uuid primary key references auth.users (id) on delete restrict,
  role text not null check (role in ('owner', 'support')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status <> 'active' or joined_at is not null),
  check (status <> 'removed' or removed_at is not null)
);
comment on table public.admin_members is
  'Who may use lokl''s admin, and as what: owner (everything) or support. Read live on every request (admin_role()). Never deleted: a removal is a status, so the history stays; at least one active owner, always. Written only by the server and the team functions (owner only), never directly by a signed-in user.';
comment on column public.admin_members.status is
  'invited (asked, not yet joined: no access), active (access, after passing the second factor), removed (no access).';

create trigger admin_members_set_updated_at
  before update on public.admin_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

-- The caller's role: an active member, signed in with a session that is
-- still current and has passed the second factor. Null otherwise (signed
-- out, not a member, removed, invited, or only the emailed code).
create function public.admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.admin_members m
   where m.user_id = auth.uid()
     and m.status = 'active'
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (select 1 from auth.sessions s
                  where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
                    and s.user_id = m.user_id
                    and s.aal = 'aal2'
                    and (s.not_after is null or s.not_after > now()));
$$;
comment on function public.admin_role() is
  'The signed-in person''s admin role (owner, support), read live from admin_members, or null: only for an active member whose session is current and passed the second factor (aal2). Wrap as (select public.admin_role()) in access rules.';
revoke execute on function public.admin_role() from public, anon;
grant execute on function public.admin_role() to authenticated;

-- Every admin access rule already calls is_admin(): now live, and second-factor only.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.admin_role() is not null;
$$;
comment on function public.is_admin() is
  'True for an active admin (any role) on a session that passed the second factor: admin_role() is not null. Use in every admin policy, wrapped as (select public.is_admin()).';

create function public.is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.admin_role() = 'owner';
$$;
comment on function public.is_owner() is
  'True for an active owner on a session that passed the second factor.';
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- For the server-only admin functions: the role of the admin the server
-- acts for, on the session it names in the request header
-- x-lokl-admin-session. Refuses any caller but the server first, so the
-- header can never be trusted from a browser, even if a function's
-- permissions were widened by mistake.
create function public.admin_role_of(p_admin_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only lokl''s server can act for an admin.' using errcode = '42501';
  end if;
  begin
    v_session := nullif(current_setting('request.headers', true)::json ->> 'x-lokl-admin-session', '')::uuid;
  exception when others then
    return null;
  end;
  if v_session is null or p_admin_id is null then
    return null;
  end if;
  return (select m.role
            from public.admin_members m
           where m.user_id = p_admin_id
             and m.status = 'active'
             and exists (select 1 from auth.sessions s
                          where s.id = v_session
                            and s.user_id = p_admin_id
                            and s.aal = 'aal2'
                            and (s.not_after is null or s.not_after > now())));
end;
$$;
comment on function public.admin_role_of(uuid) is
  'For server-only admin functions: the role of p_admin_id on the session named in the request header x-lokl-admin-session (current, aal2), or null. Refuses (42501) any caller but service_role, whatever its permissions.';
revoke execute on function public.admin_role_of(uuid) from public, anon, authenticated;

-- Recording what Stripe has already done for an admin's cancellation (a
-- refund made, or a request's hold released) whose reply was lost: Stripe's
-- signed webhook, a later cancellation of the same booking, or a retry
-- finishes it, with no admin session (decided 2026-10-18). The server says
-- so in the header x-lokl-finishing: stripe, and is the only caller allowed
-- (as for admin_role_of). Nothing new is done this way: the money has
-- already moved, under an admin's checked session. The admin is named by
-- the refund's metadata and must be (or have been) on the team, so a
-- removal since can't hide what happened.
create function public.admin_finishing_stripe(p_admin_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only lokl''s server can act for an admin.' using errcode = '42501';
  end if;
  return coalesce(current_setting('request.headers', true)::json ->> 'x-lokl-finishing', '') = 'stripe'
     and exists (select 1 from public.admin_members m where m.user_id = p_admin_id);
exception when invalid_text_representation then
  return false;
end;
$$;
comment on function public.admin_finishing_stripe(uuid) is
  'For admin_cancel_booking only: true when lokl''s server is recording what Stripe already did for an admin''s cancellation (header x-lokl-finishing: stripe) and p_admin_id is or was on the team. Refuses (42501) any caller but service_role.';
revoke execute on function public.admin_finishing_stripe(uuid) from public, anon, authenticated;

-- What the switch makes of the signed-in person (the cutover's check).
create function public.admin_role_preview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', public.admin_role(),
    'member', (select jsonb_build_object('role', m.role, 'status', m.status) from public.admin_members m where m.user_id = auth.uid()),
    'second_factor_passed', coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2',
    'authenticators', (select count(*) from auth.mfa_factors f
                        where f.user_id = auth.uid() and f.factor_type = 'totp' and f.status = 'verified'));
$$;
comment on function public.admin_role_preview() is
  'For the signed-in person: their admin role now (or null), their admin_members row, whether this session passed the second factor, and how many authenticators they have. Says nothing about anyone else.';
revoke execute on function public.admin_role_preview() from public, anon;
grant execute on function public.admin_role_preview() to authenticated;

-- ---------------------------------------------------------------------------
-- GUARDS
-- ---------------------------------------------------------------------------

-- At least one active owner, always: no removal, downgrade or other change
-- leaves none, whoever makes it (the server included). One at a time, so
-- two owners removing each other can't both get through.
create function public.admin_members_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('admin_members:owners', 0));
  if old.role = 'owner' and old.status = 'active' and (new.role <> 'owner' or new.status <> 'active')
     and not exists (select 1 from public.admin_members m
                      where m.role = 'owner' and m.status = 'active' and m.user_id <> old.user_id) then
    raise exception 'lokl must always have an owner. Make someone else an owner first.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.admin_members_keep_an_owner() is
  'Trigger: refuses any change that would leave admin_members without an active owner.';
-- Trigger functions reach no API role (function_privileges 4).
revoke execute on function public.admin_members_keep_an_owner() from public, anon, authenticated, service_role;
create trigger admin_members_keep_an_owner
  before update on public.admin_members
  for each row execute function public.admin_members_keep_an_owner();

create function public.admin_members_never_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Team members are never deleted: remove them instead (their history stays).' using errcode = 'check_violation';
end;
$$;
comment on function public.admin_members_never_delete() is
  'Trigger: refuses deleting or truncating admin_members; a removal is a status.';
-- Trigger functions reach no API role (function_privileges 4).
revoke execute on function public.admin_members_never_delete() from public, anon, authenticated, service_role;
create trigger admin_members_never_delete
  before delete on public.admin_members
  for each row execute function public.admin_members_never_delete();
create trigger admin_members_never_truncate
  before truncate on public.admin_members
  for each statement execute function public.admin_members_never_delete();

-- An admin login never owns a business (admin_owns_no_provider), now read
-- from admin_members, both ways.
create function public.admin_members_owns_no_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'removed' and exists (select 1 from public.providers p where p.owner_id = new.user_id) then
    raise exception 'This login owns a business, so it can''t be on the team. Use a separate login.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.admin_members_owns_no_provider() is
  'Trigger: refuses making a login that owns a business a team member (admin_owns_no_provider, from the team''s side).';
-- Trigger functions reach no API role (function_privileges 4).
revoke execute on function public.admin_members_owns_no_provider() from public, anon, authenticated, service_role;
create trigger admin_members_owns_no_provider
  before insert or update of user_id, status on public.admin_members
  for each row execute function public.admin_members_owns_no_provider();

create or replace function public.providers_owner_not_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admin_members m
             where m.user_id = new.owner_id and m.status <> 'removed') then
    raise exception 'An admin login can''t own a business. Use a separate login for the provider.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.providers_owner_not_admin() is
  'Trigger: refuses giving a business to a login on the team (admin_members, not removed).';

-- ---------------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------------

alter table public.admin_members enable row level security;
create policy admin_members_read_own on public.admin_members for select to authenticated
  using (user_id = (select auth.uid()));
comment on policy admin_members_read_own on public.admin_members is
  'Each person can read their own team row (whether they''re invited, active or removed).';
create policy admin_members_read_owner on public.admin_members for select to authenticated
  using ((select public.is_owner()));
comment on policy admin_members_read_owner on public.admin_members is
  'Owners (second factor passed) can read the whole team.';
revoke all on public.admin_members from anon, authenticated;
grant select on public.admin_members to authenticated;

-- ---------------------------------------------------------------------------
-- SEEDING: today's admins become active owners, with no gap in access
-- ---------------------------------------------------------------------------

insert into public.admin_members (user_id, role, status, invited_at, joined_at)
select u.id, 'owner', 'active', now(), now()
  from auth.users u
 where u.raw_app_meta_data ->> 'role' = 'admin'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- SERVER-ONLY ADMIN FUNCTIONS: the live role and the named session
-- ---------------------------------------------------------------------------
-- Each is its newest definition with one line changed: the check of
-- raw_app_meta_data becomes admin_role_of(p_admin_id) (sources noted);
-- admin_cancel_booking also accepts recording what Stripe already did
-- (admin_finishing_stripe).

-- admin_cancel_booking: from 20261011024704_money_lost_replies.sql.
create or replace function public.admin_cancel_booking(
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
  if public.admin_role_of(p_admin_id) is null and not public.admin_finishing_stripe(p_admin_id) then
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

-- admin_release_payout: from 20261011024704_money_lost_replies.sql.
create or replace function public.admin_release_payout(p_booking_id uuid, p_admin_id uuid, p_reason text, p_hold text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.admin_role_of(p_admin_id) is null then
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

-- admin_resolve_problem_paid: from 20261011024704_money_lost_replies.sql.
create or replace function public.admin_resolve_problem_paid(p_booking_id uuid, p_admin_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.admin_role_of(p_admin_id) is null then
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

-- admin_set_provider_status: from 20261003013910_provider_account_emails.sql.
create or replace function public.admin_set_provider_status(
  p_provider_id uuid, p_status text, p_admin_id uuid, p_reason text, p_message text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  -- Only the website's server calls this, after checking the admin. As a
  -- second line of defence, the id it passes must be an admin's.
  if public.admin_role_of(p_admin_id) is null then
    raise exception 'Only an admin can suspend or reinstate a provider.' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'A provider is active or suspended.' using errcode = 'check_violation';
  end if;
  update public.providers set status = p_status where id = p_provider_id and status <> p_status;
  if not found then
    if not exists (select 1 from public.providers where id = p_provider_id) then
      raise exception 'No such provider.' using errcode = 'no_data_found';
    end if;
    return false;
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values (p_admin_id, 'provider', p_provider_id,
          case when p_status = 'suspended' then 'suspend_provider' else 'reinstate_provider' end,
          p_reason, v_message)
  returning id into v_action;
  insert into public.provider_emails (provider_id, admin_action_id, kind, message)
  values (p_provider_id, v_action,
          case when p_status = 'suspended' then 'provider_account_paused' else 'provider_account_active' end,
          v_message);
  return true;
end;
$$;

-- admin_remove_provider_profile_content: from 20261004162333_provider_profiles.sql.
create or replace function public.admin_remove_provider_profile_content(
  p_provider_id uuid, p_admin_id uuid, p_parts text[], p_rule text, p_reason text, p_message text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.providers;
  v_action uuid;
  v_files text[] := '{}';
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  -- Only the website's server calls this, after checking the admin. As a
  -- second line of defence, the id it passes must be an admin's.
  if public.admin_role_of(p_admin_id) is null then
    raise exception 'Only an admin can remove profile content.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_parts, 1), 0) = 0 or not (p_parts <@ array['avatar', 'cover', 'headline', 'bio']) then
    raise exception 'Choose what to remove: the profile photo, cover photo, headline or bio.' using errcode = 'check_violation';
  end if;
  -- Every removal names the rule it broke (the provider's email says which).
  if p_rule is null or p_rule not in ('contact_details', 'private_information', 'abuse', 'impersonation', 'unsuitable_photo', 'not_yours') then
    raise exception 'Choose the profile rule this content breaks.' using errcode = 'check_violation';
  end if;
  select * into v_old from public.providers where id = p_provider_id for update;
  if not found then
    raise exception 'No such provider.' using errcode = 'no_data_found';
  end if;

  update public.providers set
    avatar_path = case when 'avatar' = any (p_parts) then null else avatar_path end,
    avatar_small_path = case when 'avatar' = any (p_parts) then null else avatar_small_path end,
    cover_path = case when 'cover' = any (p_parts) then null else cover_path end,
    cover_card_path = case when 'cover' = any (p_parts) then null else cover_card_path end,
    headline = case when 'headline' = any (p_parts) then null else headline end,
    bio = case when 'bio' = any (p_parts) then null else bio end
  where id = p_provider_id;

  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values (p_admin_id, 'provider', p_provider_id, 'remove_profile_content', p_reason, v_message)
  returning id into v_action;
  insert into public.provider_emails (provider_id, admin_action_id, kind, message, removed, rule)
  values (p_provider_id, v_action, 'provider_profile_edited', v_message, p_parts, p_rule);

  -- The removed photos' files, for the server to delete from storage.
  if 'avatar' = any (p_parts) then v_files := v_files || array_remove(array[v_old.avatar_path, v_old.avatar_small_path], null); end if;
  if 'cover' = any (p_parts) then v_files := v_files || array_remove(array[v_old.cover_path, v_old.cover_card_path], null); end if;
  return v_files;
end;
$$;

-- admin_moderate_review: from 20261004193319_reviews.sql.
create or replace function public.admin_moderate_review(
  p_review_id uuid,
  p_admin_id uuid,
  p_target text,
  p_action text,
  p_rule text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reviews;
  rp public.review_replies;
  v_reason text := trim(coalesce(p_reason, ''));
  v_log text;
  v_reports integer;
begin
  if public.admin_role_of(p_admin_id) is null then
    raise exception 'Only an admin can moderate reviews.' using errcode = 'insufficient_privilege';
  end if;
  if p_target not in ('review', 'reply') or p_action not in ('remove', 'restore', 'keep') then
    raise exception 'Unknown moderation: % %.', p_action, p_target using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = 'check_violation';
  end if;
  if p_action = 'remove' and (p_rule is null or p_rule not in ('abuse', 'private_information', 'off_topic', 'spam', 'sexual_or_illegal', 'conflict_of_interest')) then
    raise exception 'Choose the review rule it breaks.' using errcode = 'check_violation';
  end if;

  select * into r from public.reviews where id = p_review_id for update;
  if not found then
    raise exception 'No such review.' using errcode = 'no_data_found';
  end if;
  if p_target = 'reply' then
    select * into rp from public.review_replies where review_id = p_review_id for update;
    if not found then
      raise exception 'This review has no reply.' using errcode = 'no_data_found';
    end if;
  end if;

  if p_action = 'remove' then
    if p_target = 'review' then
      if r.status = 'removed' then raise exception 'This review is already removed.' using errcode = 'check_violation'; end if;
      update public.reviews set status = 'removed', removed_at = now(), removed_rule = p_rule, removed_reason = v_reason where id = r.id;
      perform public.booking_emails_queue(r.booking_id, array['customer_review_removed']);
      v_log := 'remove_review';
    else
      if rp.status = 'removed' then raise exception 'This reply is already removed.' using errcode = 'check_violation'; end if;
      update public.review_replies set status = 'removed', removed_at = now(), removed_rule = p_rule, removed_reason = v_reason where review_id = r.id;
      perform public.booking_emails_queue(r.booking_id, array['provider_reply_removed']);
      v_log := 'remove_review_reply';
    end if;
    update public.review_reports set status = 'upheld', resolved_at = now(), resolved_by = p_admin_id, resolution_note = v_reason
    where review_id = r.id and target = p_target and status = 'open';
  elsif p_action = 'restore' then
    if p_target = 'review' then
      if r.status = 'published' then raise exception 'This review isn''t removed.' using errcode = 'check_violation'; end if;
      update public.reviews set status = 'published', removed_at = null, removed_rule = null, removed_reason = null where id = r.id;
      v_log := 'restore_review';
    else
      if rp.status = 'published' then raise exception 'This reply isn''t removed.' using errcode = 'check_violation'; end if;
      update public.review_replies set status = 'published', removed_at = null, removed_rule = null, removed_reason = null where review_id = r.id;
      v_log := 'restore_review_reply';
    end if;
  else
    update public.review_reports set status = 'dismissed', resolved_at = now(), resolved_by = p_admin_id, resolution_note = v_reason
    where review_id = r.id and target = p_target and status = 'open';
    get diagnostics v_reports = row_count;
    if v_reports = 0 then
      raise exception 'There are no open reports on this % to dismiss.', p_target using errcode = 'check_violation';
    end if;
    v_log := 'dismiss_review_reports';
  end if;

  insert into public.admin_actions (admin_id, target, target_id, action, reason, rule)
  values (p_admin_id, 'review', r.id, v_log, v_reason, case when p_action = 'remove' then p_rule end);
end;
$$;

-- publish_guide: from 20261003050800_guide_cover_minimum_1600.sql.
create or replace function public.publish_guide(p_guide_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.guides;
  c public.guide_photos;
begin
  if public.admin_role_of(p_admin_id) is null then
    raise exception 'Only an admin can publish a guide.' using errcode = 'insufficient_privilege';
  end if;
  select * into g from public.guides where id = p_guide_id for update;
  if g.id is null then
    raise exception 'No such guide.' using errcode = 'no_data_found';
  end if;
  if char_length(trim(g.draft_title)) < 3 then
    raise exception 'Add a title.' using errcode = 'check_violation';
  end if;
  if char_length(trim(g.draft_teaser)) < 20 then
    raise exception 'Add a teaser of at least 20 characters. It shows under the photo and in search results.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(coalesce(g.draft_body -> 'blocks', '[]'::jsonb)) = 0 then
    raise exception 'Write the guide before publishing it.' using errcode = 'check_violation';
  end if;
  if g.draft_area_id is null and g.draft_category_id is null then
    raise exception 'Choose an area or a category, so the guide can show matching listings.' using errcode = 'check_violation';
  end if;
  if g.ai_draft_pending_review then
    raise exception 'This AI draft hasn''t been reviewed yet. Check the highlighted phrases and the facts, then mark it reviewed.' using errcode = 'check_violation';
  end if;
  select * into c from public.guide_photos where id = g.draft_cover_photo_id;
  if c.id is null then
    raise exception 'Add a cover photo.' using errcode = 'check_violation';
  end if;
  if c.width < 1600 or c.height < 900 or c.width <= c.height then
    raise exception 'The cover photo needs to be landscape and at least 1,600 by 900 pixels (this one is % by %).', c.width, c.height
      using errcode = 'check_violation';
  end if;

  update public.guides set
    title = g.draft_title, teaser = g.draft_teaser, body = g.draft_body, cover_photo_id = g.draft_cover_photo_id,
    area_id = g.draft_area_id, category_id = g.draft_category_id, listing_kind = g.draft_listing_kind,
    status = 'published',
    published_at = coalesce(g.published_at, now()),
    content_updated_at = case
      when g.title is distinct from g.draft_title or g.teaser is distinct from g.draft_teaser
        or g.body is distinct from g.draft_body or g.cover_photo_id is distinct from g.draft_cover_photo_id
        or g.area_id is distinct from g.draft_area_id or g.category_id is distinct from g.draft_category_id
        or g.listing_kind is distinct from g.draft_listing_kind
        or g.content_updated_at is null
      then now() else g.content_updated_at end
  where id = g.id;
  insert into public.guide_versions (guide_id, title, teaser, body, cover_photo_id, area_id, category_id, listing_kind, published_by)
  values (g.id, g.draft_title, g.draft_teaser, g.draft_body, g.draft_cover_photo_id, g.draft_area_id, g.draft_category_id,
          g.draft_listing_kind, p_admin_id);
end;
$$;

-- unpublish_guide: from 20261003040326_destination_guides.sql.
create or replace function public.unpublish_guide(p_guide_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.admin_role_of(p_admin_id) is null then
    raise exception 'Only an admin can unpublish a guide.' using errcode = 'insufficient_privilege';
  end if;
  update public.guides set status = 'unpublished' where id = p_guide_id and status = 'published';
  -- Off the homepage at once.
  delete from public.homepage_features where guide_id = p_guide_id;
end;
$$;

-- support_admin_report: from 20261017065603_support_admin_actions.sql.
create or replace function public.support_admin_report(p_report_id uuid, p_admin_id uuid)
returns public.support_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports;
begin
  if public.admin_role_of(p_admin_id) is null then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_report from public.support_reports where id = p_report_id for update;
  if v_report.id is null then
    raise exception 'We couldn''t find that report.' using errcode = 'no_data_found';
  end if;
  return v_report;
end;
$$;

-- support_notify: from 20261017053502_support_reports.sql; every active member, not every admin login.
create or replace function public.support_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports;
  v_kind text;
begin
  if tg_table_name = 'support_reports' then
    v_report := new;
    v_kind := case when new.category = 'safety' then 'support_safety' else 'support_new' end;
  else
    select * into v_report from public.support_reports where id = new.report_id;
    -- The thread's effects on the report: who wrote last; a provider's reply
    -- brings a report waiting on them back, and reopens one resolved in the
    -- last 30 days (an older one refuses the reply: support_messages_check).
    update public.support_reports
       set last_message_at = new.created_at,
           last_message_from = new.author_kind,
           status = case when new.author_kind = 'provider' and status = 'waiting' then 'in_progress'
                         when new.author_kind = 'provider' and status = 'done' then 'todo'
                         else status end,
           status_changed_by = case when new.author_kind = 'provider' and status in ('waiting', 'done') then 'provider' else status_changed_by end,
           status_changed_by_id = case when new.author_kind = 'provider' and status in ('waiting', 'done') then new.author_id else status_changed_by_id end
     where id = new.report_id;
    if new.author_kind = 'admin' then
      -- The provider's bell and email.
      insert into public.notifications (provider_id, kind, support_report_id) values (v_report.provider_id, 'support_reply', v_report.id);
      insert into public.support_emails (report_id, kind, provider_id) values (v_report.id, 'provider_support_reply', v_report.provider_id);
      return null;
    end if;
    v_kind := 'support_reply';
  end if;
  -- Every active admin (admin_members): the bell, and an email.
  insert into public.admin_notifications (recipient_id, kind, report_id)
  select m.user_id, v_kind, v_report.id from public.admin_members m where m.status = 'active';
  insert into public.support_emails (report_id, kind, admin_id)
  select v_report.id, case v_kind when 'support_safety' then 'admin_support_safety' when 'support_new' then 'admin_support_new' else 'admin_support_reply' end, m.user_id
    from public.admin_members m where m.status = 'active';
  return null;
end;
$$;
