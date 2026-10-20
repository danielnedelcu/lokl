-- Admin roles, step 5e (docs/design/admin-roles.md, "Removing profile
-- content, for support"; decided 2026-10-18 and 2026-10-20): support hides
-- profile content, the owner decides.
--
-- 1. Holds: hiding a provider's headline, bio, profile photo or cover moves
--    it out of the profile into provider_profile_holds, with the rule it
--    breaks, a reason and an optional message to the provider. The profile
--    column is cleared, so every public page, the sitemap and the
--    provider's card stop showing it at once (the providers trigger raises
--    the listings cache version); nothing public reads holds.
-- 2. Photos leave the public bucket: the server moves a hidden photo's two
--    files into provider-photos-held, which only the team can read (by a
--    short-lived link), and records it here (admin_profile_hold_files). A
--    move that fails stays on the queue as still public, to try again.
-- 3. The owner decides, never on their own: confirm the removal (the text
--    and files are deleted), restore it (only while the slot is still
--    empty), or, once the provider has replaced it, dismiss it (the hidden
--    version didn't break the rule; it's discarded). A hold waiting over 7
--    days goes to the top of the owner's queue and stays hidden.
-- 4. Fixes: support can no longer remove profile content outright
--    (admin_remove_provider_profile_content and the photo files' admin
--    delete rule are the owner's now), and a provider can't write a held
--    photo's path back into their profile.
-- 5. The provider is told each step by email (hidden, removed, restored,
--    reviewed) and sees an open hold on their profile page
--    (my_profile_holds); every owner is alerted when support hides
--    something; each step is logged in admin_actions.

-- ---------------------------------------------------------------------------
-- 1. THE LOG, EMAILS AND ALERTS
-- ---------------------------------------------------------------------------

alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded', 'retry_email',
  'suspend_provider', 'reinstate_provider', 'remove_profile_content', 'remove_review', 'restore_review',
  'remove_review_reply', 'restore_review_reply', 'dismiss_review_reports', 'support_reply', 'support_reply_wait',
  'support_move', 'support_note',
  'invite_admin', 'change_admin_role', 'remove_admin', 'reset_admin_mfa', 'join_admin', 'break_glass_owner',
  'request_action', 'decline_request', 'withdraw_request', 'limit_reached',
  'approve_listing', 'reject_listing', 'unpublish_listing', 'restore_listing',
  'publish_guide', 'unpublish_guide', 'set_homepage_features', 'change_admin_settings',
  'add_category', 'change_category', 'add_market', 'change_market', 'add_area', 'change_area',
  'hide_profile_content', 'confirm_profile_removal', 'restore_profile_content', 'dismiss_profile_hold'));
-- Hiding needs a reason; the owner's decision takes an optional note.
alter table public.admin_actions drop constraint admin_actions_reason;
alter table public.admin_actions add constraint admin_actions_reason check (
  action in ('retry_email', 'support_reply', 'support_reply_wait', 'support_move', 'support_note', 'join_admin', 'withdraw_request', 'limit_reached',
             'approve_listing', 'restore_listing', 'publish_guide', 'unpublish_guide', 'set_homepage_features',
             'add_category', 'change_category', 'add_market', 'change_market', 'add_area', 'change_area',
             'confirm_profile_removal', 'restore_profile_content', 'dismiss_profile_hold')
  or char_length(trim(reason)) >= 5);

alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check check (kind in (
  'support_new', 'support_safety', 'support_reply', 'team_change', 'request_new', 'request_decided', 'limit_reached', 'support_refund',
  'listing_taken_down', 'settings_change', 'profile_hidden'));
alter table public.admin_notifications drop constraint admin_notifications_about_check;
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  num_nonnulls(report_id, admin_action_id, admin_request_id) = 1
  and (kind in ('support_new', 'support_safety', 'support_reply')) = (report_id is not null)
  and (kind in ('team_change', 'limit_reached', 'support_refund', 'listing_taken_down', 'settings_change', 'profile_hidden')) = (admin_action_id is not null)
  and (kind in ('request_new', 'request_decided')) = (admin_request_id is not null));
alter table public.admin_emails drop constraint admin_emails_kind_check;
alter table public.admin_emails add constraint admin_emails_kind_check check (kind in (
  'admin_invite', 'admin_team_change', 'admin_request_new', 'admin_limit_reached', 'admin_support_refund',
  'admin_listing_taken_down', 'admin_settings_change', 'admin_profile_hidden'));

-- The provider's emails: hidden (lokl will review it), removed (as
-- before), restored, and reviewed (a hidden version they'd already
-- replaced didn't break the rule). Each names the parts and the rule.
alter table public.provider_emails drop constraint provider_emails_kind_check;
alter table public.provider_emails add constraint provider_emails_kind_check check (kind in (
  'provider_account_paused', 'provider_account_active', 'provider_profile_edited',
  'provider_profile_hidden', 'provider_profile_restored', 'provider_profile_reviewed'));
alter table public.provider_emails drop constraint provider_emails_profile_edit_named;
alter table public.provider_emails add constraint provider_emails_profile_edit_named check (
  kind not in ('provider_profile_edited', 'provider_profile_hidden', 'provider_profile_restored', 'provider_profile_reviewed')
  or (rule is not null and coalesce(array_length(removed, 1), 0) > 0));
comment on column public.provider_emails.removed is 'For the profile emails: which parts of the profile lokl hid, removed, restored or reviewed.';
comment on column public.provider_emails.rule is 'For the profile emails: the profile rule concerned (PROFILE_RULES in packages/types).';

-- ---------------------------------------------------------------------------
-- 2. HOLDS
-- ---------------------------------------------------------------------------

create table public.provider_profile_holds (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete restrict,
  part text not null check (part in ('avatar', 'cover', 'headline', 'bio')),
  rule text not null check (rule in ('contact_details', 'private_information', 'abuse', 'impersonation', 'unsuitable_photo', 'not_yours')),
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  message text check (char_length(message) <= 1000),
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_action_id uuid not null references public.admin_actions (id) on delete restrict,
  hidden_at timestamptz not null default now(),
  -- The hidden version: a headline or bio's text, or a photo's two files
  -- (where they were public, and where they're kept while hidden).
  held_text text check (char_length(held_text) <= 1000),
  public_paths text[] check (cardinality(public_paths) = 2),
  held_paths text[] check (cardinality(held_paths) = 2),
  files text not null check (files in ('none', 'moving', 'private', 'missing', 'restoring', 'public', 'deleting', 'deleted')),
  -- The owner's decision.
  status text not null default 'hidden' check (status in ('hidden', 'removed', 'restored', 'dismissed')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_action_id uuid references public.admin_actions (id) on delete restrict,
  decided_at timestamptz,
  constraint provider_profile_holds_text_or_photo check (
    case when part in ('headline', 'bio') then files = 'none' and public_paths is null and held_paths is null
         else files <> 'none' and public_paths is not null and held_paths is not null and held_text is null end),
  constraint provider_profile_holds_text_kept check (part not in ('headline', 'bio') or status in ('removed', 'dismissed') or held_text is not null),
  constraint provider_profile_holds_decided check ((status = 'hidden') = (decided_at is null) and (status = 'hidden') = (decided_action_id is null))
);
comment on table public.provider_profile_holds is
  'Profile content lokl''s team has hidden (admin roles step 5e): one row per part, with the rule it breaks, why, and the hidden version, until the owner confirms the removal, restores it, or dismisses it. Never deleted; once decided, only its files'' state changes.';
comment on column public.provider_profile_holds.reason is 'Why it was hidden, for lokl only (never shown to the provider).';
comment on column public.provider_profile_holds.message is 'lokl''s optional message to the provider, included in their email.';
comment on column public.provider_profile_holds.held_text is 'A hidden headline or bio. Cleared when the removal is confirmed or the hold dismissed (the content is deleted).';
comment on column public.provider_profile_holds.public_paths is 'A hidden photo''s two files (main and small or card copy) where they were, in provider-photos.';
comment on column public.provider_profile_holds.held_paths is 'Where a hidden photo''s files are kept, in the private provider-photos-held bucket: <provider id>/<hold id>/<file name>.';
comment on column public.provider_profile_holds.files is
  'A photo''s files: moving (still public, to be moved), private (kept in provider-photos-held), missing (gone before they could be moved), restoring (to be moved back), public (back on the profile), deleting (to be deleted), deleted. none for text.';
create index provider_profile_holds_open on public.provider_profile_holds (hidden_at) where status = 'hidden';
create index provider_profile_holds_provider on public.provider_profile_holds (provider_id, hidden_at);
create index provider_profile_holds_files on public.provider_profile_holds (files) where files in ('moving', 'restoring', 'deleting');

-- Only the decision and the files' state ever change; never deleted.
create function public.provider_profile_holds_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Hidden profile content is kept: holds are never deleted.' using errcode = 'check_violation';
  end if;
  if (new.id, new.provider_id, new.part, new.rule, new.reason, new.message, new.hidden_action_id, new.hidden_at, new.public_paths, new.held_paths)
     is distinct from
     (old.id, old.provider_id, old.part, old.rule, old.reason, old.message, old.hidden_action_id, old.hidden_at, old.public_paths, old.held_paths)
     or (new.hidden_by is distinct from old.hidden_by and new.hidden_by is not null)
     or (new.held_text is distinct from old.held_text and new.held_text is not null) then
    raise exception 'A hold''s record doesn''t change; only its decision and its files'' state do.' using errcode = 'check_violation';
  end if;
  if old.status <> 'hidden' and (new.status, new.decided_by, new.decided_action_id, new.decided_at) is distinct from (old.status, old.decided_by, old.decided_action_id, old.decided_at)
     and not (new.decided_by is null and old.decided_by is not null and (new.status, new.decided_action_id, new.decided_at) is not distinct from (old.status, old.decided_action_id, old.decided_at)) then
    raise exception 'This hold has already been decided.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.provider_profile_holds_guard() is 'Trigger function: a hold is never deleted, its record never changes, and its decision is made once (a deleted login may clear hidden_by or decided_by).';
revoke execute on function public.provider_profile_holds_guard() from public, anon, authenticated, service_role;
create trigger provider_profile_holds_guard before update or delete on public.provider_profile_holds
  for each row execute function public.provider_profile_holds_guard();
create trigger provider_profile_holds_guard_truncate before truncate on public.provider_profile_holds
  for each statement execute function public.provider_profile_holds_guard();

alter table public.provider_profile_holds enable row level security;
create policy provider_profile_holds_read_admin on public.provider_profile_holds for select to authenticated
  using ((select public.is_admin()));
comment on policy provider_profile_holds_read_admin on public.provider_profile_holds is
  'The team reads every hold, the hidden version included. Providers learn of their own through my_profile_holds(), never the reason; nobody writes holds but the admin functions.';
grant select on public.provider_profile_holds to authenticated;

-- ---------------------------------------------------------------------------
-- 3. PHOTOS: THE PRIVATE BUCKET, AND THE FIXES
-- ---------------------------------------------------------------------------

-- Hidden photos, kept until the owner decides. Private: no public URL;
-- the team reads a file by a short-lived signed link. Only the server
-- (service role) writes or deletes here, so a provider can't remove the
-- hidden version before the owner has seen it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('provider-photos-held', 'provider-photos-held', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);
create policy provider_photos_held_read_admin
  on storage.objects for select to authenticated
  using (bucket_id = 'provider-photos-held' and (select public.is_admin()));
comment on policy provider_photos_held_read_admin on storage.objects is
  'The team can read hidden profile photos (by signed link) in provider-photos-held. Nobody else can read them, and only the server writes or deletes them.';

-- Fix: deleting a provider's photo files was open to every admin, so
-- support could delete outright. Deleting is the owner's (support hides).
drop policy provider_photos_objects_delete_admin on storage.objects;
create policy provider_photos_objects_delete_owner
  on storage.objects for delete to authenticated
  using (bucket_id = 'provider-photos' and (select public.is_owner()));
comment on policy provider_photos_objects_delete_owner on storage.objects is
  'The owner can delete any file in the provider-photos bucket. Support hides a photo instead (admin_hide_profile_content).';

-- Fix: a provider could write a hidden photo's path back into their
-- profile. Refused when it's a signed-in user writing through the API
-- (role authenticated); lokl's server and functions restore it.
create function public.providers_no_held_paths()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The API role, not current_user (inside this function that's its owner).
  if coalesce(auth.role(), '') = 'authenticated' and exists (
       select 1 from public.provider_profile_holds h,
              lateral unnest(coalesce(h.public_paths, '{}') || coalesce(h.held_paths, '{}')) as p(path)
        where h.provider_id = new.id
          -- Only holds still undecided (a restored photo's path stays in
          -- its hold), and only a path being written now (a form that
          -- saves every field re-sends the unchanged ones).
          and h.status = 'hidden'
          and p.path in (case when new.avatar_path is distinct from old.avatar_path then new.avatar_path end,
                         case when new.avatar_small_path is distinct from old.avatar_small_path then new.avatar_small_path end,
                         case when new.cover_path is distinct from old.cover_path then new.cover_path end,
                         case when new.cover_card_path is distinct from old.cover_card_path then new.cover_card_path end)) then
    raise exception 'That photo was hidden by lokl, so it can''t go back on your profile. Upload a new one.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.providers_no_held_paths() is 'Trigger function: a provider can''t put a photo lokl has hidden (and not yet decided on) back on their profile by its path. Only paths being changed are checked.';
revoke execute on function public.providers_no_held_paths() from public, anon, authenticated, service_role;
create trigger providers_no_held_paths
  before update of avatar_path, avatar_small_path, cover_path, cover_card_path on public.providers
  for each row execute function public.providers_no_held_paths();

-- Fix: removing profile content outright is the owner's (support hides).
-- admin_remove_provider_profile_content: from 20261018194929_admin_members.sql.
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
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Removing profile content needs the owner. Hide it instead: the owner decides.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_parts, 1), 0) = 0 or not (p_parts <@ array['avatar', 'cover', 'headline', 'bio']) then
    raise exception 'Choose what to remove: the profile photo, cover photo, headline or bio.' using errcode = 'check_violation';
  end if;
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

  if 'avatar' = any (p_parts) then v_files := v_files || array_remove(array[v_old.avatar_path, v_old.avatar_small_path], null); end if;
  if 'cover' = any (p_parts) then v_files := v_files || array_remove(array[v_old.cover_path, v_old.cover_card_path], null); end if;
  return v_files;
end;
$$;
comment on function public.admin_remove_provider_profile_content(uuid, uuid, text[], text, text, text) is
  'Server only: the owner removes parts of a provider''s profile outright (the files are deleted after), logged, and the provider emailed. Refuses support, who hide instead (admin_hide_profile_content).';

-- ---------------------------------------------------------------------------
-- 4. HIDING, THE FILES, AND THE OWNER'S DECISION
-- ---------------------------------------------------------------------------

create function public.admin_hide_profile_content(
  p_admin_id uuid, p_provider_id uuid, p_parts text[], p_rule text, p_reason text, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role_of(p_admin_id);
  p public.providers;
  v_parts text[];
  v_part text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_action uuid;
  v_hold uuid;
  v_paths text[];
  v_moves jsonb := '[]'::jsonb;
begin
  if v_role is null then
    raise exception 'Only lokl''s team can hide profile content.' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_parts from unnest(p_parts) x;
  if cardinality(v_parts) = 0 or not (v_parts <@ array['avatar', 'cover', 'headline', 'bio']) then
    raise exception 'Choose what to hide: the profile photo, cover photo, headline or bio.' using errcode = 'check_violation';
  end if;
  if p_rule is null or p_rule not in ('contact_details', 'private_information', 'abuse', 'impersonation', 'unsuitable_photo', 'not_yours') then
    raise exception 'Choose the profile rule this content breaks.' using errcode = 'check_violation';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Say why, in a few words. It''s kept in the provider''s history.' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 1000 or char_length(coalesce(v_message, '')) > 1000 then
    raise exception 'Keep the reason and the message under 1,000 characters each.' using errcode = 'check_violation';
  end if;
  select * into p from public.providers where id = p_provider_id for update;
  if p.id is null then
    raise exception 'No such provider.' using errcode = 'no_data_found';
  end if;
  foreach v_part in array v_parts loop
    if (case v_part when 'avatar' then p.avatar_path when 'cover' then p.cover_path when 'headline' then p.headline else p.bio end) is null then
      raise exception 'There''s no % to hide.', case v_part when 'avatar' then 'profile photo' when 'cover' then 'cover photo' when 'headline' then 'headline' else 'about text' end
        using errcode = 'check_violation';
    end if;
  end loop;

  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values (p_admin_id, 'provider', p.id, 'hide_profile_content', v_reason, v_message)
  returning id into v_action;

  foreach v_part in array v_parts loop
    v_hold := gen_random_uuid();
    v_paths := case v_part when 'avatar' then array[p.avatar_path, p.avatar_small_path]
                           when 'cover' then array[p.cover_path, p.cover_card_path] end;
    insert into public.provider_profile_holds
      (id, provider_id, part, rule, reason, message, hidden_by, hidden_action_id, held_text, public_paths, held_paths, files)
    values (v_hold, p.id, v_part, p_rule, v_reason, v_message, p_admin_id, v_action,
            case v_part when 'headline' then p.headline when 'bio' then p.bio end,
            v_paths,
            case when v_paths is not null then
              array(select p.id || '/' || v_hold || '/' || regexp_replace(f, '^.*/', '') from unnest(v_paths) f) end,
            case when v_paths is null then 'none' else 'moving' end);
    if v_paths is not null then
      v_moves := v_moves || jsonb_build_object('hold_id', v_hold, 'from', to_jsonb(v_paths),
        'to', (select to_jsonb(held_paths) from public.provider_profile_holds where id = v_hold));
    end if;
  end loop;

  -- Off the profile at once (the providers trigger raises the cache version).
  update public.providers set
    avatar_path = case when 'avatar' = any (v_parts) then null else avatar_path end,
    avatar_small_path = case when 'avatar' = any (v_parts) then null else avatar_small_path end,
    cover_path = case when 'cover' = any (v_parts) then null else cover_path end,
    cover_card_path = case when 'cover' = any (v_parts) then null else cover_card_path end,
    headline = case when 'headline' = any (v_parts) then null else headline end,
    bio = case when 'bio' = any (v_parts) then null else bio end
  where id = p.id;

  insert into public.provider_emails (provider_id, admin_action_id, kind, message, removed, rule)
  values (p.id, v_action, 'provider_profile_hidden', v_message, v_parts, p_rule);
  if v_role = 'support' then
    perform public.admin_alert_owners(v_action, 'profile_hidden', 'admin_profile_hidden');
  end if;
  -- The photos' files, for the server to move into provider-photos-held.
  return v_moves;
end;
$$;
comment on function public.admin_hide_profile_content(uuid, uuid, text[], text, text, text) is
  'Server only: an admin (support or owner, on their own session) hides parts of a provider''s profile that break a profile rule: each is kept in a hold and cleared from the profile at once, logged, and the provider emailed; support hiding alerts every owner. Returns the photos'' files for the server to move into the private bucket.';
revoke execute on function public.admin_hide_profile_content(uuid, uuid, text[], text, text, text) from public, anon, authenticated;

-- What happened to a photo's files, as the server reports it after moving
-- or deleting them. Only the next state in its path is accepted.
create function public.admin_profile_hold_files(p_hold_id uuid, p_files text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.provider_profile_holds;
begin
  select * into h from public.provider_profile_holds where id = p_hold_id for update;
  if h.id is null then
    raise exception 'No such hold.' using errcode = 'no_data_found';
  end if;
  if not ((h.files = 'moving' and p_files in ('private', 'missing'))
          or (h.files = 'restoring' and p_files = 'public')
          or (h.files = 'deleting' and p_files = 'deleted')) then
    raise exception 'A hold''s files can''t go from % to %.', h.files, p_files using errcode = 'check_violation';
  end if;
  update public.provider_profile_holds set files = p_files where id = h.id;
  -- Back where they were: on the profile again, unless the provider has
  -- filled the slot meanwhile.
  if p_files = 'public' then
    update public.providers set
      avatar_path = case when h.part = 'avatar' and avatar_path is null then h.public_paths[1] else avatar_path end,
      avatar_small_path = case when h.part = 'avatar' and avatar_path is null then h.public_paths[2] else avatar_small_path end,
      cover_path = case when h.part = 'cover' and cover_path is null then h.public_paths[1] else cover_path end,
      cover_card_path = case when h.part = 'cover' and cover_path is null then h.public_paths[2] else cover_card_path end
    where id = h.provider_id;
  end if;
end;
$$;
comment on function public.admin_profile_hold_files(uuid, text) is
  'Server only: records what happened to a hidden photo''s files: moved into provider-photos-held (private) or already gone (missing), moved back (public, and back on the profile if the slot is still empty), or deleted.';
revoke execute on function public.admin_profile_hold_files(uuid, text) from public, anon, authenticated;

create function public.admin_decide_profile_hold(p_admin_id uuid, p_hold_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.provider_profile_holds;
  p public.providers;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_filled boolean;
  v_action uuid;
  v_files text := null;
  v_work jsonb := null;
begin
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Only the owner decides on hidden profile content.' using errcode = 'insufficient_privilege';
  end if;
  if p_decision is null or p_decision not in ('remove', 'restore', 'dismiss') then
    raise exception 'Choose to confirm the removal, restore it, or dismiss it.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note under 1,000 characters.' using errcode = 'check_violation';
  end if;
  select * into h from public.provider_profile_holds where id = p_hold_id for update;
  if h.id is null then
    raise exception 'No such hidden content.' using errcode = 'no_data_found';
  end if;
  if h.status is distinct from 'hidden' then
    raise exception 'This was already decided.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into p from public.providers where id = h.provider_id for update;
  -- Has the provider put something new in the slot since?
  v_filled := (case h.part when 'avatar' then p.avatar_path when 'cover' then p.cover_path when 'headline' then p.headline else p.bio end) is not null;

  if p_decision = 'restore' then
    if v_filled then
      raise exception 'They''ve added a new one since, so restoring would replace it. Confirm the removal, or dismiss it if the hidden version didn''t break the rule.'
        using errcode = 'check_violation';
    end if;
    if h.files = 'missing' then
      raise exception 'The photo''s files were gone before lokl could keep them, so it can''t be restored.' using errcode = 'check_violation';
    end if;
    if h.part in ('headline', 'bio') then
      update public.providers set
        headline = case when h.part = 'headline' then h.held_text else headline end,
        bio = case when h.part = 'bio' then h.held_text else bio end
      where id = p.id;
    elsif h.files = 'moving' then
      -- Never moved: the files are still public, so it goes straight back.
      update public.providers set
        avatar_path = case when h.part = 'avatar' then h.public_paths[1] else avatar_path end,
        avatar_small_path = case when h.part = 'avatar' then h.public_paths[2] else avatar_small_path end,
        cover_path = case when h.part = 'cover' then h.public_paths[1] else cover_path end,
        cover_card_path = case when h.part = 'cover' then h.public_paths[2] else cover_card_path end
      where id = p.id;
      v_files := 'public';
    else
      v_files := 'restoring';
      v_work := jsonb_build_object('hold_id', h.id, 'move_back', true, 'from', to_jsonb(h.held_paths), 'to', to_jsonb(h.public_paths));
    end if;
  else
    -- Dismiss is only for a version the provider has already replaced:
    -- one still in its slot that didn't break the rule is restored.
    if p_decision = 'dismiss' and not v_filled then
      raise exception 'Dismiss is only for content they''ve already replaced. If the hidden version didn''t break the rule, restore it.'
        using errcode = 'check_violation';
    end if;
    -- Either way the hidden version is deleted: the text now, the files by the server.
    if h.files in ('moving', 'private') then
      v_files := 'deleting';
      v_work := jsonb_build_object('hold_id', h.id, 'delete', true,
        'bucket', case h.files when 'private' then 'provider-photos-held' else 'provider-photos' end,
        'paths', to_jsonb(case h.files when 'private' then h.held_paths else h.public_paths end));
    elsif h.files = 'missing' then
      v_files := 'deleted';
    end if;
  end if;

  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (p_admin_id, 'provider', h.provider_id,
          case p_decision when 'remove' then 'confirm_profile_removal' when 'restore' then 'restore_profile_content' else 'dismiss_profile_hold' end,
          v_note)
  returning id into v_action;
  update public.provider_profile_holds set
    status = case p_decision when 'remove' then 'removed' when 'restore' then 'restored' else 'dismissed' end,
    decided_by = p_admin_id, decided_action_id = v_action, decided_at = now(),
    held_text = case when p_decision = 'restore' then held_text end,
    files = coalesce(v_files, files)
  where id = h.id;
  insert into public.provider_emails (provider_id, admin_action_id, kind, removed, rule)
  values (h.provider_id, v_action,
          case p_decision when 'remove' then 'provider_profile_edited' when 'restore' then 'provider_profile_restored' else 'provider_profile_reviewed' end,
          array[h.part], h.rule);
  -- The files to move back or delete, for the server; null when there are none.
  return v_work;
end;
$$;
comment on function public.admin_decide_profile_hold(uuid, uuid, text, text) is
  'Server only: the owner decides on hidden profile content: remove (confirm it broke the rule; the hidden version is deleted), restore (back on the profile, only while the slot is still empty), or dismiss (only once the provider has replaced it: the hidden version didn''t break the rule, and is discarded). Logged; the provider emailed. Returns the files for the server to move back or delete.';
revoke execute on function public.admin_decide_profile_hold(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE OWNER'S QUEUE, AND THE PROVIDER'S VIEW
-- ---------------------------------------------------------------------------

create function public.admin_profile_holds_page(p_scope text default 'open', p_page integer default 1, p_page_size integer default 25, p_provider_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role();
  v_me uuid := (select auth.uid());
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
begin
  if v_role is null then
    raise exception 'Only lokl''s team can see hidden profile content.' using errcode = 'insufficient_privilege';
  end if;
  if p_scope is null or p_scope not in ('open', 'decided', 'all') then
    raise exception 'Choose open, decided or all.' using errcode = 'check_violation';
  end if;
  -- The owner sees every hold; support, the ones they made, or every one
  -- of a provider's on that provider's page.
  return (
    with mine as (
      select h.* from public.provider_profile_holds h
       where (p_scope = 'all' or (p_scope = 'open') = (h.status = 'hidden'))
         and (p_provider_id is null or h.provider_id = p_provider_id)
         and (v_role = 'owner' or h.hidden_by = v_me or p_provider_id is not null)
    ), paged as (
      select m.*, now() >= m.hidden_at + interval '7 days' as overdue from mine m
       order by case when p_scope <> 'decided' then (m.status = 'hidden') end desc nulls last,
                case when p_scope <> 'decided' then (m.status = 'hidden' and now() >= m.hidden_at + interval '7 days') end desc nulls last,
                case when p_scope <> 'decided' then m.hidden_at end asc,
                m.decided_at desc nulls last, m.id
       limit v_size offset (v_page - 1) * v_size
    )
    select jsonb_build_object(
      'total', (select count(*) from mine),
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'part', g.part, 'rule', g.rule, 'reason', g.reason, 'message', g.message,
        'hidden_at', g.hidden_at, 'overdue', g.status = 'hidden' and g.overdue, 'status', g.status, 'files', g.files,
        'held_text', g.held_text, 'held_paths', to_jsonb(g.held_paths), 'public_paths', to_jsonb(g.public_paths),
        'decided_at', g.decided_at,
        'hidden_by_email', (select u.email from auth.users u join public.admin_members am on am.user_id = u.id where u.id = g.hidden_by),
        'decided_by_email', (select u.email from auth.users u join public.admin_members am on am.user_id = u.id where u.id = g.decided_by),
        'slot_filled', (case g.part when 'avatar' then pr.avatar_path when 'cover' then pr.cover_path when 'headline' then pr.headline else pr.bio end) is not null,
        'provider', jsonb_build_object('id', pr.id, 'name', pr.display_name, 'slug', pr.slug)
      ) order by case when p_scope <> 'decided' then (g.status = 'hidden') end desc nulls last,
                 case when p_scope <> 'decided' then (g.status = 'hidden' and g.overdue) end desc nulls last,
                 case when p_scope <> 'decided' then g.hidden_at end asc, g.decided_at desc nulls last, g.id), '[]'::jsonb))
      from paged g join public.providers pr on pr.id = g.provider_id);
end;
$$;
comment on function public.admin_profile_holds_page(text, integer, integer, uuid) is
  'The hidden profile content queue: open (waiting over 7 days first, then oldest), decided (newest first) or all, a page at a time, with the hidden version and whether the provider has filled the slot since. The owner sees every hold; support the ones they made, or all of one provider''s (p_provider_id, their admin page).';
revoke execute on function public.admin_profile_holds_page(text, integer, integer, uuid) from public, anon;
grant execute on function public.admin_profile_holds_page(text, integer, integer, uuid) to authenticated;

create function public.my_profile_holds()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('part', h.part, 'rule', h.rule, 'hidden_at', h.hidden_at) order by h.hidden_at), '[]'::jsonb)
    from public.provider_profile_holds h
   where h.status = 'hidden'
     and h.provider_id in (select p.id from public.providers p where p.owner_id = (select auth.uid()));
$$;
comment on function public.my_profile_holds() is
  'For the provider''s profile page: the parts of their profile lokl has hidden and not yet decided, with the rule. Never the reason or the hidden version.';
revoke execute on function public.my_profile_holds() from public, anon;
grant execute on function public.my_profile_holds() to authenticated;
