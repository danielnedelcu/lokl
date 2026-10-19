-- Admin roles, step 5a (docs/design/admin-roles.md; decided 2026-10-18 and
-- 2026-10-19): what only the owner may do, and the team itself.
--
-- 1. Owner-only areas: categories, markets and areas; the commission rates;
--    guides, their photos and the homepage's guides (support still reads
--    them all). Their rules and functions switch from is_admin() to the
--    owner (is_owner(), or admin_role_of() = 'owner' for the server's).
-- 2. Alerts (the tables section 3 writes): a team change goes to every
--    active owner, in the admin bell and by email (admin_emails, a new
--    outbox), the owner's own changes included, so a takeover is visible;
--    an invitation is emailed to the invited person.
-- 3. The team: invite (the website's server, after making the login),
--    change a role, remove (every session ended at once), reset someone's
--    second factor, and join (the invited person, past the second step,
--    within 7 days). The owner's own role and membership aren't theirs to
--    change here; the last active owner stays (admin_members_keep_an_owner).
--    Every change is logged in admin_actions.

-- ---------------------------------------------------------------------------
-- 1. OWNER-ONLY AREAS
-- ---------------------------------------------------------------------------

-- is_owner() returned null, not false, for anyone who isn't an admin, so a
-- plpgsql "if not is_owner()" let them through (found writing 5a's tests;
-- its only use until now was a row rule, where null already refuses).
create or replace function public.is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.admin_role() = 'owner', false);
$$;

-- Categories, markets and areas: written by the owner; read as before.
drop policy categories_insert_admin on public.categories;
drop policy categories_update_admin on public.categories;
create policy categories_insert_owner on public.categories for insert to authenticated
  with check ((select public.is_owner()));
create policy categories_update_owner on public.categories for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy categories_insert_owner on public.categories is 'The owner adds categories.';
comment on policy categories_update_owner on public.categories is 'The owner edits categories and switches them on or off.';

drop policy cities_insert_admin on public.cities;
drop policy cities_update_admin on public.cities;
create policy cities_insert_owner on public.cities for insert to authenticated
  with check ((select public.is_owner()));
create policy cities_update_owner on public.cities for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy cities_insert_owner on public.cities is 'The owner adds markets.';
comment on policy cities_update_owner on public.cities is 'The owner edits markets and opens or closes them.';

drop policy service_areas_insert_admin on public.service_areas;
drop policy service_areas_update_admin on public.service_areas;
create policy service_areas_insert_owner on public.service_areas for insert to authenticated
  with check ((select public.is_owner()));
create policy service_areas_update_owner on public.service_areas for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy service_areas_insert_owner on public.service_areas is 'The owner adds service areas.';
comment on policy service_areas_update_owner on public.service_areas is 'The owner edits service areas and switches them on or off.';

drop policy commission_rates_update_admin on public.commission_rates;
create policy commission_rates_update_owner on public.commission_rates for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy commission_rates_update_owner on public.commission_rates is
  'The owner changes the commission rates (each change logged in commission_rate_changes).';

-- Guides and their photos: every admin reads them; the owner writes.
drop policy guides_admin on public.guides;
create policy guides_read_admin on public.guides for select to authenticated
  using ((select public.is_admin()));
create policy guides_write_owner on public.guides for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy guides_read_admin on public.guides is 'Every admin reads every guide, drafts included.';
comment on policy guides_write_owner on public.guides is 'The owner writes guides (support reads them only).';

drop policy guide_photos_admin on public.guide_photos;
create policy guide_photos_read_admin on public.guide_photos for select to authenticated
  using ((select public.is_admin()));
create policy guide_photos_write_owner on public.guide_photos for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy guide_photos_read_admin on public.guide_photos is 'Every admin reads guide photos.';
comment on policy guide_photos_write_owner on public.guide_photos is 'The owner adds, describes and removes guide photos.';

drop policy homepage_features_write_admin on public.homepage_features;
create policy homepage_features_write_owner on public.homepage_features for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
comment on policy homepage_features_write_owner on public.homepage_features is
  'The owner chooses the homepage''s guides (admin_set_homepage_features).';

-- The guide photos' files.
drop policy guide_photos_objects_insert_admin on storage.objects;
drop policy guide_photos_objects_delete_admin on storage.objects;
create policy guide_photos_objects_insert_owner on storage.objects for insert to authenticated
  with check (bucket_id = 'guide-photos' and (select public.is_owner())
    and exists (select 1 from public.guides g where g.id::text = (storage.foldername(objects.name))[1]));
create policy guide_photos_objects_delete_owner on storage.objects for delete to authenticated
  using (bucket_id = 'guide-photos' and (select public.is_owner()));
comment on policy guide_photos_objects_insert_owner on storage.objects is
  'The owner uploads a guide''s photos, into that guide''s own folder.';
comment on policy guide_photos_objects_delete_owner on storage.objects is
  'The owner deletes a guide''s photo files.';

-- publish_guide: from 20261018194929_admin_members.sql, the owner only.
CREATE OR REPLACE FUNCTION public.publish_guide(p_guide_id uuid, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g public.guides;
  c public.guide_photos;
begin
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Only the owner can publish a guide.' using errcode = 'insufficient_privilege';
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
$function$;

-- unpublish_guide: from 20261018194929_admin_members.sql, the owner only.
CREATE OR REPLACE FUNCTION public.unpublish_guide(p_guide_id uuid, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Only the owner can unpublish a guide.' using errcode = 'insufficient_privilege';
  end if;
  update public.guides set status = 'unpublished' where id = p_guide_id and status = 'published';
  -- Off the homepage at once.
  delete from public.homepage_features where guide_id = p_guide_id;
end;
$function$;

-- admin_set_homepage_features: from 20261011171614_homepage_three_guides.sql, the owner only.
CREATE OR REPLACE FUNCTION public.admin_set_homepage_features(p_guide_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can choose the homepage''s guides.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_guide_ids), 0) > 3 then
    raise exception 'The homepage shows a main guide and up to two more.' using errcode = 'check_violation';
  end if;
  if (select count(distinct x) from unnest(p_guide_ids) x) <> coalesce(cardinality(p_guide_ids), 0) then
    raise exception 'Each guide can be on the homepage once.' using errcode = 'check_violation';
  end if;
  delete from public.homepage_features where true;
  insert into public.homepage_features (position, guide_id)
  select n, id from unnest(p_guide_ids) with ordinality as t(id, n);
end;
$function$;
comment on function public.publish_guide(uuid, uuid) is
  'Server only: publishes a guide''s draft (or publishes changes): checks the title, teaser, body, area or category, review and a landscape cover of at least 1,600 x 900, copies the draft (text, cover and listings block) over the live copy, and keeps a version. Refuses anyone but the owner (2026-10-19).';
comment on function public.unpublish_guide(uuid, uuid) is
  'Server only: unpublishes a guide and takes it off the homepage. Refuses anyone but the owner (2026-10-19).';
comment on function public.admin_set_homepage_features(uuid[]) is
  'The owner only: replaces the homepage guides with these, in this order, in one step: the first is the main guide, the others (up to two) the guides section''s cards. Each once, published only (the homepage_features trigger checks).';

-- ---------------------------------------------------------------------------
-- 2. THE TEAM'S RECORD AND ALERTS
-- ---------------------------------------------------------------------------

-- admin_actions: team changes, about a member (target_id is their login).
alter table public.admin_actions drop constraint admin_actions_target_check;
alter table public.admin_actions add constraint admin_actions_target_check check (target in (
  'booking', 'provider', 'email', 'review', 'support_report', 'admin_member'));
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded', 'retry_email',
  'suspend_provider', 'reinstate_provider', 'remove_profile_content', 'remove_review', 'restore_review',
  'remove_review_reply', 'restore_review_reply', 'dismiss_review_reports', 'support_reply', 'support_reply_wait',
  'support_move', 'support_note',
  'invite_admin', 'change_admin_role', 'remove_admin', 'reset_admin_mfa', 'join_admin', 'break_glass_owner'));

-- A reason with every team change but joining (the person themselves).
-- Listed, not left to the check's null: a missing reason passes it.
alter table public.admin_actions drop constraint admin_actions_reason;
alter table public.admin_actions add constraint admin_actions_reason check (
  action in ('retry_email', 'support_reply', 'support_reply_wait', 'support_move', 'support_note', 'join_admin')
  or char_length(trim(reason)) >= 5);

-- The admin bell: a team change too, pointing at its admin_actions row.
alter table public.admin_notifications alter column report_id drop not null;
alter table public.admin_notifications add column admin_action_id uuid references public.admin_actions (id) on delete restrict;
alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check
  check (kind in ('support_new', 'support_safety', 'support_reply', 'team_change'));
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  (kind = 'team_change') = (admin_action_id is not null) and (kind = 'team_change') = (report_id is null));
create index admin_notifications_admin_action on public.admin_notifications (admin_action_id) where admin_action_id is not null;
comment on table public.admin_notifications is
  'The admin bell: a new report (support_safety for a Safety one) or a provider''s reply, one row per admin login; and a team change (team_change, its admin_actions row) for every active owner. Each admin reads and marks read only their own. Ids only: published to Realtime, so an open report reloads its thread. Deleted with the admin''s login.';
comment on column public.admin_notifications.admin_action_id is
  'For a team change: the admin_actions row saying who did what (invite, role change, removal, second factor reset, join).';

-- The team's emails: an invitation to the person invited, and every team
-- change to each active owner. Never a reason or note: what happened, and
-- a link to the Team page or the sign-in.
create table public.admin_emails (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('admin_invite', 'admin_team_change')),
  admin_action_id uuid not null references public.admin_actions (id) on delete restrict,
  -- The login it goes to (no key: an outbox row is never deleted, and the
  -- login may be). Its address is read when the email is sent.
  recipient_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  to_address text check (char_length(to_address) <= 320),
  resend_id text,
  last_error text check (char_length(last_error) <= 500),
  skip_reason text check (char_length(skip_reason) <= 200),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.admin_emails is
  'The team''s email outbox (admin roles, 2026-10-19): an invitation to the person invited (admin_invite), and each team change to every active owner (admin_team_change), their own included. Never a reason or note. Only its delivery details change (outbox_guard); never deleted. The server sends it; the owner reads it.';
create index admin_emails_due on public.admin_emails (next_attempt_at) where status in ('pending', 'failed');
create trigger admin_emails_outbox_guard before update or delete on public.admin_emails
  for each row execute function public.outbox_guard();
create trigger admin_emails_outbox_guard_truncate before truncate on public.admin_emails
  for each statement execute function public.outbox_guard();
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;
grant select on public.admin_emails to authenticated;
create policy admin_emails_read_owner on public.admin_emails for select to authenticated
  using ((select public.is_owner()));
comment on policy admin_emails_read_owner on public.admin_emails is 'The owner reads the team''s outbox (who was emailed, and how it went).';

-- Tells every active owner about a team change: the bell and an email.
create function public.admin_team_alert(p_action_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_notifications (recipient_id, kind, admin_action_id)
  select m.user_id, 'team_change', p_action_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
  insert into public.admin_emails (kind, admin_action_id, recipient_id)
  select 'admin_team_change', p_action_id, m.user_id from public.admin_members m where m.status = 'active' and m.role = 'owner';
$$;
comment on function public.admin_team_alert(uuid) is
  'The team functions'' own: a team change in every active owner''s bell and inbox, the owner''s own changes included (so a takeover is visible).';
revoke execute on function public.admin_team_alert(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE TEAM FUNCTIONS
-- ---------------------------------------------------------------------------

-- A reason is required for every team change, as for the other admin actions.
create function public.admin_team_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why, in a few words.' using errcode = 'check_violation';
  end if;
  return btrim(p_reason);
end;
$$;
comment on function public.admin_team_reason(text) is 'The team functions'' own: the reason, trimmed, or a plain refusal under 5 characters.';
revoke execute on function public.admin_team_reason(text) from public, anon, authenticated;

-- Invite: the website's server, as the owner (the session header), after
-- making sure the person has a login (Supabase's admin API creates one if
-- not). By email, as the owner typed it. Also invites again someone whose
-- invitation lapsed or who was removed.
create function public.admin_invite(p_admin_id uuid, p_email text, p_role text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_user uuid;
  v_action uuid;
begin
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Only the owner can invite someone to the team.' using errcode = 'insufficient_privilege';
  end if;
  if p_role is null or p_role not in ('owner', 'support') then
    raise exception 'Choose a role: owner or support.' using errcode = 'check_violation';
  end if;
  v_reason := public.admin_team_reason(p_reason);
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'There''s no login for that email.' using errcode = 'no_data_found';
  end if;
  if v_user = p_admin_id then
    raise exception 'You''re on the team already.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.admin_members where user_id = v_user and status = 'active') then
    raise exception 'They''re on the team already.' using errcode = 'check_violation';
  end if;
  insert into public.admin_members (user_id, role, status, invited_by, invited_at)
  values (v_user, p_role, 'invited', p_admin_id, now())
  on conflict (user_id) do update set role = excluded.role, status = 'invited', invited_by = excluded.invited_by,
    invited_at = now(), joined_at = null, removed_by = null, removed_at = null;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values (p_admin_id, 'admin_member', v_user, 'invite_admin', v_reason, 'as ' || p_role)
  returning id into v_action;
  insert into public.admin_emails (kind, admin_action_id, recipient_id) values ('admin_invite', v_action, v_user);
  perform public.admin_team_alert(v_action);
  return v_user;
end;
$$;
comment on function public.admin_invite(uuid, text, text, text) is
  'Server only, as the owner: invites the login with this email to the team as owner or support (again, if their invitation lapsed or they were removed), logs it, emails them an invitation and tells every owner; returns their login id. Refuses anyone but the owner, and a login that owns a business (admin_members_owns_no_provider).';
revoke execute on function public.admin_invite(uuid, text, text, text) from public, anon, authenticated;

-- The owner's own session, through the API, for the rest.
create function public.admin_change_role(p_user_id uuid, p_role text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old text;
  v_action uuid;
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can change a role.' using errcode = 'insufficient_privilege';
  end if;
  if p_role is null or p_role not in ('owner', 'support') then
    raise exception 'Choose a role: owner or support.' using errcode = 'check_violation';
  end if;
  v_reason := public.admin_team_reason(p_reason);
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own role. Ask another owner.' using errcode = 'check_violation';
  end if;
  select role into v_old from public.admin_members where user_id = p_user_id and status in ('invited', 'active') for update;
  if not found then
    raise exception 'They''re not on the team.' using errcode = 'no_data_found';
  end if;
  if v_old = p_role then
    return 'unchanged';
  end if;
  update public.admin_members set role = p_role where user_id = p_user_id;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values (auth.uid(), 'admin_member', p_user_id, 'change_admin_role', v_reason, v_old || ' to ' || p_role)
  returning id into v_action;
  perform public.admin_team_alert(v_action);
  return 'changed';
end;
$$;
comment on function public.admin_change_role(uuid, text, text) is
  'The owner, through the API: makes a team member (invited or active) owner or support, logged with the old and new role, every owner told. Never their own role; never leaving no active owner.';
revoke execute on function public.admin_change_role(uuid, text, text) from public, anon;
grant execute on function public.admin_change_role(uuid, text, text) to authenticated;

create function public.admin_remove(p_user_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_action uuid;
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can remove someone from the team.' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.admin_team_reason(p_reason);
  if p_user_id = auth.uid() then
    raise exception 'You can''t remove yourself. Ask another owner.' using errcode = 'check_violation';
  end if;
  update public.admin_members set status = 'removed', removed_by = auth.uid(), removed_at = now()
   where user_id = p_user_id and status in ('invited', 'active');
  if not found then
    raise exception 'They''re not on the team.' using errcode = 'no_data_found';
  end if;
  -- Signed out everywhere at once: their refresh tokens go with their
  -- sessions, and admin_role() needs a live session anyway.
  delete from auth.sessions where user_id = p_user_id;
  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (auth.uid(), 'admin_member', p_user_id, 'remove_admin', v_reason)
  returning id into v_action;
  perform public.admin_team_alert(v_action);
  return 'removed';
end;
$$;
comment on function public.admin_remove(uuid, text) is
  'The owner, through the API: removes a team member (their row kept, marked removed) and signs them out everywhere at once, logged, every owner told. Never themselves; never leaving no active owner.';
revoke execute on function public.admin_remove(uuid, text) from public, anon;
grant execute on function public.admin_remove(uuid, text) to authenticated;

create function public.admin_reset_second_factor(p_user_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_action uuid;
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can reset someone''s second factor.' using errcode = 'insufficient_privilege';
  end if;
  v_reason := public.admin_team_reason(p_reason);
  if p_user_id = auth.uid() then
    raise exception 'Change your own authenticators on the Security page.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.admin_members where user_id = p_user_id and status in ('invited', 'active')) then
    raise exception 'They''re not on the team.' using errcode = 'no_data_found';
  end if;
  -- Their authenticators (and open challenges) and their sessions: their
  -- next sign-in sets up a new authenticator.
  delete from auth.mfa_factors where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  insert into public.admin_actions (admin_id, target, target_id, action, reason)
  values (auth.uid(), 'admin_member', p_user_id, 'reset_admin_mfa', v_reason)
  returning id into v_action;
  perform public.admin_team_alert(v_action);
  return 'reset';
end;
$$;
comment on function public.admin_reset_second_factor(uuid, text) is
  'The owner, through the API: removes a team member''s authenticators and signs them out, so they set up a new one at their next sign-in (a lost phone), logged, every owner told. Never their own.';
revoke execute on function public.admin_reset_second_factor(uuid, text) from public, anon;
grant execute on function public.admin_reset_second_factor(uuid, text) to authenticated;

-- Join: the invited person, on a session past the second step, within 7
-- days of the invitation.
create function public.admin_join()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invited timestamptz;
  v_action uuid;
begin
  select invited_at into v_invited from public.admin_members where user_id = v_uid and status = 'invited' for update;
  if not found then
    raise exception 'There''s no invitation for this login.' using errcode = 'no_data_found';
  end if;
  if v_invited <= now() - interval '7 days' then
    raise exception 'This invitation has lapsed. Ask the owner to send it again.' using errcode = 'check_violation';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' or not exists (
       select 1 from auth.sessions s
        where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.user_id = v_uid
          and s.aal = 'aal2' and (s.not_after is null or s.not_after > now())) then
    raise exception 'Set up your authenticator and pass the second step first.' using errcode = 'insufficient_privilege';
  end if;
  update public.admin_members set status = 'active', joined_at = now() where user_id = v_uid;
  insert into public.admin_actions (admin_id, target, target_id, action)
  values (v_uid, 'admin_member', v_uid, 'join_admin')
  returning id into v_action;
  perform public.admin_team_alert(v_action);
  return 'joined';
end;
$$;
comment on function public.admin_join() is
  'The invited person, through the API: joins the team once they''ve passed the second step, within 7 days of the invitation; logged, every owner told.';
revoke execute on function public.admin_join() from public, anon;
grant execute on function public.admin_join() to authenticated;

-- The Team page's list, for the owner: who, as what, how far along, and
-- their second factor and last sign-in (from Auth's own records).
create function public.admin_team()
returns table (user_id uuid, email text, role text, status text, invited_at timestamptz, joined_at timestamptz,
               removed_at timestamptz, invitation_lapsed boolean, authenticators integer, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can see the team.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.user_id, u.email::text, m.role, m.status, m.invited_at, m.joined_at, m.removed_at,
         m.status = 'invited' and m.invited_at <= now() - interval '7 days',
         (select count(*)::integer from auth.mfa_factors f where f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'),
         u.last_sign_in_at
    from public.admin_members m
    join auth.users u on u.id = m.user_id
   order by case m.status when 'active' then 0 when 'invited' then 1 else 2 end, m.joined_at nulls last, m.invited_at; -- bounded: the team
end;
$$;
comment on function public.admin_team() is
  'The owner only: every team member with their email, role, status, whether an invitation has lapsed, how many authenticators they have and when they last signed in.';
revoke execute on function public.admin_team() from public, anon;
grant execute on function public.admin_team() to authenticated;
