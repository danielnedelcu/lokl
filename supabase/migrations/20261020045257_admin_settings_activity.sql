-- Admin roles, step 5d (docs/design/admin-roles.md; decided 2026-10-18 and
-- 2026-10-20): the owner's settings, listing review in the database, and a
-- log of every admin change.
--
-- 1. Listing readiness has one source: listing_readiness() says, for one
--    listing, what's done and what blocks it going live or into review, in
--    the provider checklist's words. The provider's editor, its publish and
--    submit routes, and the admin's review page all ask it, and a trigger
--    (listings_require_ready, replacing listings_require_photo) refuses a
--    move into live or submitted while a blocking item isn't done, naming
--    what's missing. Only the move is checked: a listing already live is
--    never blocked by a later change elsewhere.
-- 2. Listing review: admin_set_listing_status() approves (Experiences
--    only: Services go live without review), sends back, takes down and
--    restores, as the admin's own session, and logs it. Support taking down
--    a live listing alerts every owner.
-- 3. Settings: admin_update_settings() lets the owner change the refund
--    limit and support's daily limits, with a reason; logged, and every
--    owner is told.
-- 4. Logs for what wasn't logged: publishing and unpublishing a guide, the
--    homepage's guides, and adding or changing a category, market or area
--    (a trigger, since the owner writes those tables directly).
-- 5. admin_activity_page(): the Activity page. The owner sees everyone's
--    actions; support sees their own.

-- ---------------------------------------------------------------------------
-- 1. LISTING READINESS
-- ---------------------------------------------------------------------------

-- The rules, from one listing row and what's saved around it. Takes the row
-- so the trigger can check the values being written (kind, location).
create function public.listing_readiness_of(l public.listings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select
      exists (select 1 from public.providers p where p.id = l.provider_id and p.status = 'active') as account,
      exists (select 1 from public.listing_photos where listing_id = l.id) as photos,
      exists (select 1 from public.listing_addresses where listing_id = l.id) as address,
      exists (select 1 from public.listing_service_areas where listing_id = l.id) as travel_areas,
      exists (select 1 from public.experience_sessions s
               where s.listing_id = l.id and s.status = 'scheduled' and s.starts_at > now()) as sessions,
      exists (select 1 from public.providers p
               where p.id = l.provider_id and p.stripe_account_id is not null
                 and p.stripe_charges_enabled and p.stripe_payouts_enabled) as payouts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', v.key, 'label', v.label, 'done', v.done,
           'blocks_live', v.blocks_live, 'blocks_submit', v.blocks_submit) order by v.ord), '[]'::jsonb)
    from f, lateral (values
      (1, 'account', 'Your account is active', f.account, true, true, true),
      (2, 'photos', 'Add at least one photo', f.photos, true, true, true),
      (3, 'address', case when l.kind = 'experience' then 'Add the meeting address' else 'Add your address' end,
          f.address, true, true, l.kind = 'experience' or l.location_mode = 'provider_location'),
      (4, 'travel_areas', 'Choose at least one area you travel to', f.travel_areas, true, true,
          l.kind = 'service' and l.location_mode = 'customer_location'),
      -- Without sessions a live Experience can be seen but not booked. That's
      -- allowed (a host may add dates after approval): a nudge, not a block.
      (5, 'sessions', 'Add at least one upcoming session so customers can book', f.sessions, false, false,
          l.kind = 'experience'),
      -- Payouts block going live, for both kinds; an Experience may be sent
      -- for review before them, but isn't approved until they're ready.
      (6, 'payouts', case when l.kind = 'service' then 'Set up payouts' else 'Set up payouts (needed before we can approve it)' end,
          f.payouts, true, false, true)
    ) as v(ord, key, label, done, blocks_live, blocks_submit, applies)
   where v.applies;
$$;
comment on function public.listing_readiness_of(public.listings) is
  'The listing readiness rules, for one listings row: each item (key, label in the provider checklist''s words, done, blocks_live, blocks_submit), in checklist order. Used by listing_readiness() and the listings_require_ready trigger; the only copy of the rules.';
revoke execute on function public.listing_readiness_of(public.listings) from public, anon, authenticated;

create function public.listing_readiness(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing_id;
  if l.id is null
     or (coalesce(auth.role(), '') = 'service_role'
         or public.is_admin()
         or exists (select 1 from public.providers p where p.id = l.provider_id and p.owner_id = (select auth.uid()))) is not true then
    raise exception 'We couldn''t find that listing.' using errcode = 'no_data_found';
  end if;
  return public.listing_readiness_of(l);
end;
$$;
comment on function public.listing_readiness(uuid) is
  'What a listing needs before it can go live or be sent for review (listing_readiness_of): for its provider, the team and the server; anyone else is told it doesn''t exist. The editor''s checklist, the publish and submit routes and the admin review page all read it.';
revoke execute on function public.listing_readiness(uuid) from public, anon;
grant execute on function public.listing_readiness(uuid) to authenticated;

-- The rule, enforced: replaces listings_require_photo (photos are one of
-- its items). Only a move into live or submitted is checked.
drop trigger listings_require_photo on public.listings;
drop function public.listings_require_photo();

create function public.listings_require_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_todo text;
begin
  if new.status in ('live', 'submitted')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    select string_agg(lower(i ->> 'label'), '; ' order by n) into v_todo
      from jsonb_array_elements(public.listing_readiness_of(new)) with ordinality as t(i, n)
     where (i ->> 'done')::boolean is not true
       and (i ->> case new.status when 'live' then 'blocks_live' else 'blocks_submit' end)::boolean;
    if v_todo is not null then
      raise exception using
        errcode = 'check_violation',
        message = case new.status when 'live' then 'Before it can go live: ' else 'Before it can be sent for review: ' end
                  || v_todo || '.';
    end if;
  end if;
  return new;
end;
$$;
comment on function public.listings_require_ready() is
  'Trigger function: refuses a move into live or submitted while a blocking readiness item (listing_readiness_of) isn''t done, naming each in the checklist''s words. A listing already live or submitted isn''t checked again.';

-- A trigger function is never called directly (the default privileges
-- would let the server key).
revoke execute on function public.listings_require_ready() from public, anon, authenticated, service_role;

create trigger listings_require_ready
  before insert or update of status on public.listings
  for each row execute function public.listings_require_ready();

-- ---------------------------------------------------------------------------
-- 2. THE LOG: NEW TARGETS, ACTIONS AND ALERTS
-- ---------------------------------------------------------------------------

-- The homepage and the settings are one thing each, so their rows name no
-- target id; everything else still does.
alter table public.admin_actions alter column target_id drop not null;
alter table public.admin_actions drop constraint admin_actions_target_check;
alter table public.admin_actions add constraint admin_actions_target_check check (target in (
  'booking', 'provider', 'email', 'review', 'support_report', 'admin_member', 'admin_request',
  'listing', 'guide', 'homepage', 'settings', 'category', 'market', 'area'));
alter table public.admin_actions add constraint admin_actions_target_id check (
  (target in ('homepage', 'settings')) = (target_id is null));
comment on column public.admin_actions.target_id is 'The row acted on, in the table target names. Empty only for the homepage and the settings, which are one thing each.';
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
  'add_category', 'change_category', 'add_market', 'change_market', 'add_area', 'change_area'));
alter table public.admin_actions drop constraint admin_actions_reason;
alter table public.admin_actions add constraint admin_actions_reason check (
  action in ('retry_email', 'support_reply', 'support_reply_wait', 'support_move', 'support_note', 'join_admin', 'withdraw_request', 'limit_reached',
             'approve_listing', 'restore_listing', 'publish_guide', 'unpublish_guide', 'set_homepage_features',
             'add_category', 'change_category', 'add_market', 'change_market', 'add_area', 'change_area')
  or char_length(trim(reason)) >= 5);
alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check check (kind in (
  'support_new', 'support_safety', 'support_reply', 'team_change', 'request_new', 'request_decided', 'limit_reached', 'support_refund',
  'listing_taken_down', 'settings_change'));
alter table public.admin_notifications drop constraint admin_notifications_about_check;
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  num_nonnulls(report_id, admin_action_id, admin_request_id) = 1
  and (kind in ('support_new', 'support_safety', 'support_reply')) = (report_id is not null)
  and (kind in ('team_change', 'limit_reached', 'support_refund', 'listing_taken_down', 'settings_change')) = (admin_action_id is not null)
  and (kind in ('request_new', 'request_decided')) = (admin_request_id is not null));
alter table public.admin_emails drop constraint admin_emails_kind_check;
alter table public.admin_emails add constraint admin_emails_kind_check check (kind in (
  'admin_invite', 'admin_team_change', 'admin_request_new', 'admin_limit_reached', 'admin_support_refund',
  'admin_listing_taken_down', 'admin_settings_change'));

-- ---------------------------------------------------------------------------
-- 3. LISTING REVIEW
-- ---------------------------------------------------------------------------

create function public.admin_set_listing_status(p_admin_id uuid, p_listing_id uuid, p_from text, p_to text, p_reason text default null)
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
end;
$$;
comment on function public.admin_set_listing_status(uuid, uuid, text, text, text) is
  'Server only: approve (submitted to live, Experiences only), send back (submitted to rejected), take down (live to unpublished) or restore (unpublished to live) a listing, for an admin on their own session (admin_role_of). Reasons of 10+ characters for sending back and taking down; readiness by the listings_require_ready trigger. Logged; support taking one down alerts every owner.';
revoke execute on function public.admin_set_listing_status(uuid, uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. SETTINGS
-- ---------------------------------------------------------------------------

create function public.admin_update_settings(
  p_refund_limit_cents integer, p_refunds_per_day integer, p_refund_cents_per_day integer,
  p_contact_views_per_day integer, p_requests_per_day integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.admin_settings;
  v_reason text := nullif(trim(p_reason), '');
  v_changes text;
  v_action_id uuid;
  v_money constant text := 'FM$999,999,990.00';
begin
  if public.is_owner() is not true then
    raise exception 'Only the owner can change the settings.' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Say why you''re changing the settings, in a few words.' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Keep the reason under 1,000 characters.' using errcode = 'check_violation';
  end if;
  select * into s from public.admin_settings where id for update;

  -- What changed, in words, for the log and the owners' alert.
  select string_agg(c, '; ' order by n) into v_changes from (values
    (1, case when p_refund_limit_cents is distinct from s.refund_limit_cents then
      'refund limit ' || to_char(s.refund_limit_cents / 100.0, v_money) || ' to ' || to_char(p_refund_limit_cents / 100.0, v_money) end),
    (2, case when p_refunds_per_day is distinct from s.support_refunds_per_day then
      'refunds a day ' || s.support_refunds_per_day || ' to ' || p_refunds_per_day end),
    (3, case when p_refund_cents_per_day is distinct from s.support_refund_cents_per_day then
      'refunds in all a day ' || to_char(s.support_refund_cents_per_day / 100.0, v_money) || ' to ' || to_char(p_refund_cents_per_day / 100.0, v_money) end),
    (4, case when p_contact_views_per_day is distinct from s.support_contact_views_per_day then
      'contact views a day ' || s.support_contact_views_per_day || ' to ' || p_contact_views_per_day end),
    (5, case when p_requests_per_day is distinct from s.support_requests_per_day then
      'requests a day ' || s.support_requests_per_day || ' to ' || p_requests_per_day end)
  ) as t(n, c) where c is not null;
  if v_changes is null then
    raise exception 'Nothing changed.' using errcode = 'check_violation';
  end if;

  -- The table's checks refuse values out of range (with the column's name).
  update public.admin_settings set
    refund_limit_cents = p_refund_limit_cents,
    support_refunds_per_day = p_refunds_per_day,
    support_refund_cents_per_day = p_refund_cents_per_day,
    support_contact_views_per_day = p_contact_views_per_day,
    support_requests_per_day = p_requests_per_day
  where id;

  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values ((select auth.uid()), 'settings', null, 'change_admin_settings', v_reason, upper(left(v_changes, 1)) || substr(v_changes, 2) || '.')
  returning id into v_action_id;
  perform public.admin_alert_owners(v_action_id, 'settings_change', 'admin_settings_change');
end;
$$;
comment on function public.admin_update_settings(integer, integer, integer, integer, integer, text) is
  'The owner''s Settings page: the refund limit and support''s daily limits (refunds, refunds in all, contact views, requests), with a reason. Logged with what changed, in words; every owner is told. Refuses anyone but the owner.';
revoke execute on function public.admin_update_settings(integer, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.admin_update_settings(integer, integer, integer, integer, integer, text) to authenticated;

comment on table public.admin_settings is
  'The owner''s settings for the team (admin roles): one row (id is always true). Support refunds directly up to refund_limit_cents of what''s left of a charge; above it, they ask the owner (admin_requests). Never deleted. Changed by the owner on the Settings page (admin_update_settings, logged).';

-- ---------------------------------------------------------------------------
-- 5. LOGS FOR GUIDES, THE HOMEPAGE, CATEGORIES, MARKETS AND AREAS
-- ---------------------------------------------------------------------------

-- publish_guide: from 20261019223225_admin_team.sql; now logged too.
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
  insert into public.admin_actions (admin_id, target, target_id, action, message)
  values (p_admin_id, 'guide', g.id, 'publish_guide', left(g.draft_title, 1000));
end;
$function$;

-- unpublish_guide: from 20261019223225_admin_team.sql; now logged, and only
-- when it was published.
CREATE OR REPLACE FUNCTION public.unpublish_guide(p_guide_id uuid, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title text;
begin
  if public.admin_role_of(p_admin_id) is distinct from 'owner' then
    raise exception 'Only the owner can unpublish a guide.' using errcode = 'insufficient_privilege';
  end if;
  update public.guides set status = 'unpublished' where id = p_guide_id and status = 'published'
  returning title into v_title;
  -- Off the homepage at once.
  delete from public.homepage_features where guide_id = p_guide_id;
  if v_title is not null then
    insert into public.admin_actions (admin_id, target, target_id, action, message)
    values (p_admin_id, 'guide', p_guide_id, 'unpublish_guide', left(v_title, 1000));
  end if;
end;
$function$;

-- admin_set_homepage_features: from 20261019223225_admin_team.sql; now
-- logged (who chose which guides, in order, by title at the time). Security
-- definer now, to write the log; it still refuses anyone but the owner.
CREATE OR REPLACE FUNCTION public.admin_set_homepage_features(p_guide_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_titles text;
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
  select string_agg(t.n || '. ' || coalesce(g.title, g.draft_title), '; ' order by t.n) into v_titles
    from unnest(p_guide_ids) with ordinality as t(id, n) join public.guides g on g.id = t.id;
  insert into public.admin_actions (admin_id, target, target_id, action, message)
  values ((select auth.uid()), 'homepage', null, 'set_homepage_features', left(coalesce(v_titles, 'No guides.'), 1000));
end;
$function$;
comment on function public.admin_set_homepage_features(uuid[]) is
  'The owner chooses the homepage''s guides (up to three, in order; published only). Logged with their titles. Refuses anyone but the owner.';

-- Categories, markets and areas: the owner writes them directly (row rules
-- allow the owner only), so a trigger logs each add or change made through
-- the API, with what changed. Migrations and the server key aren't logged.
create function public.log_reference_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_target text := tg_argv[0];
  v_message text;
begin
  if v_admin is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_message := left(to_jsonb(new) ->> 'name', 1000);
  else
    select case
             when (to_jsonb(old) ->> 'active')::boolean and not (to_jsonb(new) ->> 'active')::boolean then 'Turned off'
             when not (to_jsonb(old) ->> 'active')::boolean and (to_jsonb(new) ->> 'active')::boolean then 'Turned back on'
             else 'Changed ' || string_agg(replace(n.key, '_', ' '), ', ' order by n.key)
           end
      into v_message
      from jsonb_each(to_jsonb(new)) n
     where n.key not in ('updated_at', 'created_at')
       and n.value is distinct from to_jsonb(old) -> n.key;
    if v_message is null then
      return null;
    end if;
    v_message := left((to_jsonb(new) ->> 'name') || ': ' || lower(left(v_message, 1)) || substr(v_message, 2), 1000);
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, message)
  values (v_admin, v_target, new.id, case when tg_op = 'INSERT' then 'add_' else 'change_' end || v_target, v_message);
  return null;
end;
$$;
comment on function public.log_reference_change() is
  'Trigger function: logs an add or change to a category, market or area made through the API (the owner), naming what changed. Argument: the log''s target (category, market or area).';

revoke execute on function public.log_reference_change() from public, anon, authenticated, service_role;

create trigger categories_log after insert or update on public.categories
  for each row execute function public.log_reference_change('category');
create trigger cities_log after insert or update on public.cities
  for each row execute function public.log_reference_change('market');
create trigger service_areas_log after insert or update on public.service_areas
  for each row execute function public.log_reference_change('area');

-- ---------------------------------------------------------------------------
-- 6. THE ACTIVITY PAGE
-- ---------------------------------------------------------------------------

create function public.admin_activity_page(p_admin_id uuid default null, p_page integer default 1, p_page_size integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.admin_role();
  v_me uuid := (select auth.uid());
  v_who uuid;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
begin
  if v_role is null then
    raise exception 'Only lokl''s team can see the activity.' using errcode = 'insufficient_privilege';
  end if;
  -- Support sees their own; the owner sees everyone's, or one person's.
  v_who := case when v_role = 'owner' then p_admin_id else v_me end;
  return jsonb_build_object(
    'total', (select count(*) from public.admin_actions a where v_who is null or a.admin_id = v_who),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'admin_id', a.admin_id, 'admin_email', u.email, 'target', a.target, 'target_id', a.target_id,
               'action', a.action, 'reason', a.reason, 'message', a.message, 'amount_cents', a.amount_cents,
               'request_id', a.request_id, 'created_at', a.created_at) order by a.created_at desc, a.id)
        from (select * from public.admin_actions a
               where v_who is null or a.admin_id = v_who
               order by a.created_at desc, a.id
               limit v_size offset (v_page - 1) * v_size) a
        left join auth.users u on u.id = a.admin_id
                              and exists (select 1 from public.admin_members m where m.user_id = a.admin_id)), '[]'::jsonb));
end;
$$;
comment on function public.admin_activity_page(uuid, integer, integer) is
  'The Activity page: admin actions, newest first, a page at a time, with who did each (their team email). The owner sees everyone''s (or one person''s, p_admin_id); support sees only their own, whatever they ask for.';
revoke execute on function public.admin_activity_page(uuid, integer, integer) from public, anon;
grant execute on function public.admin_activity_page(uuid, integer, integer) to authenticated;
