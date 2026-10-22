-- Listing review emails (decided 2026-10-21): when lokl's team approves,
-- rejects, unpublishes or restores a listing, the provider is emailed as
-- well as told in the bell. A rejection or takedown carries the reason the
-- admin gave, which is the provider-facing one: the review dialog says "The
-- provider sees your reason", the provider's editor shows it, and it's the
-- only text a listing review takes (no internal notes). Nothing else from
-- lokl's side goes in the email.
--
-- 1. provider_emails: four listing kinds; a rejection or takedown must carry
--    its reason, an approval or restore none.
-- 2. admin_set_listing_status(): queues the email in the same transaction as
--    the change and its admin_actions row, one email per action. The email
--    names the listing through the action's target (admin_actions.target_id),
--    so provider_emails needs no listing column: a rejected draft can still
--    be deleted by its provider (the email then skips, as there's nothing to
--    link to).
--
-- Delete behaviour: unchanged. provider_emails rows are never deleted
-- (outbox_guard); admin_actions rows are append-only.

-- ---------------------------------------------------------------------------
-- 1. PROVIDER_EMAILS: THE LISTING KINDS
-- ---------------------------------------------------------------------------

alter table public.provider_emails drop constraint provider_emails_kind_check;
alter table public.provider_emails add constraint provider_emails_kind_check check (kind in (
  'provider_account_paused', 'provider_account_active', 'provider_profile_edited',
  'provider_profile_hidden', 'provider_profile_restored', 'provider_profile_reviewed',
  'provider_listing_approved', 'provider_listing_rejected', 'provider_listing_unpublished', 'provider_listing_restored'));

-- The reason travels only with a rejection or a takedown, where the admin
-- had to give one (at least 10 characters, admin_set_listing_status).
alter table public.provider_emails add constraint provider_emails_listing_reason check (
  kind not in ('provider_listing_rejected', 'provider_listing_unpublished', 'provider_listing_approved', 'provider_listing_restored')
  or (kind in ('provider_listing_rejected', 'provider_listing_unpublished')) = (message is not null));

comment on table public.provider_emails is
  'Emails to a provider about their account (paused, active again), their profile (content removed, hidden, restored or reviewed) and their listings'' review (approved, rejected, taken down, restored), to send, and what happened to each. One per admin action. Queued by the admin functions that act; sent by the website''s server. Server only; admins can read. Never deleted.';
comment on column public.provider_emails.message is
  'Text from lokl included in the email. For an account or profile email: lokl''s optional message (never the internal reason). For a listing rejected or taken down: the reason the provider sees in their editor (required); none for an approval or restore.';

-- ---------------------------------------------------------------------------
-- 2. ADMIN_SET_LISTING_STATUS: QUEUE THE EMAIL
-- ---------------------------------------------------------------------------

-- As defined in admin_settings_activity (step 5d), plus the email.
create or replace function public.admin_set_listing_status(p_admin_id uuid, p_listing_id uuid, p_from text, p_to text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role_of(p_admin_id);
  l public.listings;
  v_action text;
  v_reason text := nullif(trim(p_reason), '');
  v_action_id uuid;
begin
  if v_role is null then
    raise exception 'Only lokl''s team can review listings.' using errcode = 'insufficient_privilege';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if l.id is null then
    raise exception 'We couldn''t find that listing.' using errcode = 'no_data_found';
  end if;
  v_action := case
    when p_from = 'submitted' and p_to = 'live' then 'approve_listing'
    when p_from = 'submitted' and p_to = 'rejected' then 'reject_listing'
    when p_from = 'live' and p_to = 'unpublished' then 'unpublish_listing'
    when p_from = 'unpublished' and p_to = 'live' then 'restore_listing'
  end;
  if v_action is null then
    raise exception 'A listing can''t go from % to % in review.', p_from, p_to using errcode = 'check_violation';
  end if;
  if v_action = 'approve_listing' and l.kind is distinct from 'experience' then
    raise exception 'Services go live without review, so they can''t be approved.' using errcode = 'check_violation';
  end if;
  -- The status the page showed, so two people acting at once can't both succeed.
  if l.status is distinct from p_from then
    raise exception 'This listing changed in the meantime. Reload the page and try again.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_action in ('reject_listing', 'unpublish_listing') and (v_reason is null or char_length(v_reason) < 10) then
    raise exception 'Give a reason of at least 10 characters. The provider sees it.' using errcode = 'check_violation';
  end if;

  -- listings_require_ready refuses going live while something blocks it,
  -- and listings_notify_status_change tells the provider.
  update public.listings set
    status = p_to,
    reviewed_at = now(),
    rejection_reason = case when p_to = 'rejected' then v_reason when p_to = 'live' then null else rejection_reason end,
    unpublished_reason = case when p_to = 'unpublished' then v_reason end,
    published_at = case when p_to = 'live' then coalesce(published_at, now()) else published_at end
  where id = l.id;

  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (p_admin_id, 'listing', l.id, v_action, case when v_action in ('reject_listing', 'unpublish_listing') then v_reason end)
  returning id into v_action_id;
  if v_action = 'unpublish_listing' and v_role = 'support' then
    perform public.admin_alert_owners(v_action_id, 'listing_taken_down', 'admin_listing_taken_down');
  end if;

  -- The provider's email, with the same reason they see in their editor
  -- (a rejection or takedown) and nothing else.
  insert into public.provider_emails (provider_id, admin_action_id, kind, message)
  values (l.provider_id, v_action_id,
    case v_action
      when 'approve_listing' then 'provider_listing_approved'
      when 'reject_listing' then 'provider_listing_rejected'
      when 'unpublish_listing' then 'provider_listing_unpublished'
      else 'provider_listing_restored'
    end,
    case when v_action in ('reject_listing', 'unpublish_listing') then v_reason end);
end;
$$;

comment on function public.admin_set_listing_status(uuid, uuid, text, text, text) is
  'Server only: approve (submitted to live, Experiences only), send back (submitted to rejected), take down (live to unpublished) or restore (unpublished to live) a listing, for an admin on their own session (admin_role_of). Reasons of 10+ characters for sending back and taking down, which the provider sees; readiness by the listings_require_ready trigger. Logged; support taking one down alerts every owner; the provider is emailed (provider_emails), with that reason and nothing else.';
-- create or replace keeps the grants: server only, as before.
