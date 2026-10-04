-- Provider profiles (docs/design/provider-profiles.md, approved 2026-10-04):
-- part 1, database and storage.
--
-- 1. providers gains a headline, a bio, an avatar (with a small copy), a
--    cover photo (with a card copy) and a slug for the profile page. The
--    headline and bio refuse contact details (phone numbers, emails, web
--    addresses): customers reach providers through bookings.
-- 2. Signed-out visitors may read the profile's public columns, on the
--    providers they could already read (active, with a visible listing).
--    The owner's identity, Stripe fields and status stay private.
-- 3. The provider-photos bucket: public to read; a provider writes and
--    deletes only their own folder.
-- 4. Removing profile content that breaks the profile rules: one function
--    the website's server calls for an admin. It clears what's removed,
--    logs the admin action, and queues an email to the provider saying
--    what was removed and which rule it broke, in one transaction.
--
-- Delete behaviour: unchanged (providers are never deleted; the new
-- columns go with the row). Photo files are deleted by the app when
-- replaced or removed, as listing photos are.

-- ---------------------------------------------------------------------------
-- 1. The profile columns
-- ---------------------------------------------------------------------------

-- Contact details: an email, a web address, or a phone number (7 or more
-- digits with the usual separators). The same rule is in TypeScript
-- (packages/types/src/providers.ts, hasContactDetails), which the settings
-- page uses as the provider types; the shared samples in both test files
-- keep the two in step.
create or replace function public.has_contact_details(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* (
    '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    || '|(https?://|www\.)'
    || '|\y[a-z0-9-]+\.(com|net|org|io|co|us|biz|info|me|app|shop)\y'
    || '|(\+?[0-9][ ().-]?){7,}'
  );
$$;
comment on function public.has_contact_details(text) is
  'True if the text has an email, a web address or a phone number. Profile headlines and bios refuse them: customers reach providers through bookings.';

alter table public.providers
  add column headline text check (char_length(headline) <= 80 and not public.has_contact_details(headline)),
  add column bio text check (char_length(bio) <= 1000 and not public.has_contact_details(bio)),
  add column avatar_path text,
  add column avatar_small_path text,
  add column cover_path text,
  add column cover_card_path text,
  add column slug text;

-- Photos live in the provider's own folder, and come in pairs (the photo
-- and its smaller copy).
alter table public.providers
  add constraint providers_photos_own_folder check (
    (avatar_path is null or avatar_path like id::text || '/%')
    and (avatar_small_path is null or avatar_small_path like id::text || '/%')
    and (cover_path is null or cover_path like id::text || '/%')
    and (cover_card_path is null or cover_card_path like id::text || '/%')),
  add constraint providers_avatar_pair check ((avatar_path is null) = (avatar_small_path is null)),
  add constraint providers_cover_pair check ((cover_path is null) = (cover_card_path is null));

comment on column public.providers.headline is
  'One line about what the provider does. Public on their profile while they can be booked. No contact details.';
comment on column public.providers.bio is
  'About the provider, plain text. Public on their profile while they can be booked. No contact details.';
comment on column public.providers.avatar_path is
  'The profile photo or logo (square, 512px) in the provider-photos bucket, in the provider''s own folder. Public.';
comment on column public.providers.avatar_small_path is 'The profile photo''s 128px copy, for small places. Public.';
comment on column public.providers.cover_path is
  'The cover photo (landscape, at least 1,600 x 600) in the provider-photos bucket, in the provider''s own folder. Public.';
comment on column public.providers.cover_card_path is 'The cover photo''s 600px-wide copy. Public.';

-- The profile page's address: /providers/<slug>, made from the business
-- name in the database (so nobody can pick another business's address),
-- numbered if it's taken. Fixed: providers can't write it (no column grant).
-- Changing it on a rename, with a redirect, is a later improvement.
-- Security definer: it must see every provider's address to find a free
-- one, and RLS shows a signed-in provider only their own row (a new
-- provider named like an existing business would otherwise get the taken
-- address and a unique-constraint error). It reveals only whether an
-- address is taken; addresses are public anyway.
create or replace function public.provider_slug(p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base text := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g')), 60), ''), 'provider');
  v_slug text := v_base;
  v_n integer := 1;
begin
  while exists (select 1 from public.providers where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;
comment on function public.provider_slug(text) is
  'A free profile address made from a business name: lowercase words joined by hyphens, numbered (-2, -3) if taken.';

create or replace function public.providers_set_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.slug := public.provider_slug(new.display_name);
  return new;
end;
$$;
comment on function public.providers_set_slug() is 'Trigger function: gives a new provider their profile address.';
create trigger providers_set_slug
  before insert on public.providers
  for each row execute function public.providers_set_slug();

-- Existing providers, oldest first, so the earliest keeps the plain name.
do $$
declare r record;
begin
  for r in select id, display_name from public.providers order by created_at, id loop
    update public.providers set slug = public.provider_slug(r.display_name) where id = r.id;
  end loop;
end;
$$;
alter table public.providers
  alter column slug set not null,
  add constraint providers_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 70),
  add constraint providers_slug_unique unique (slug);
comment on column public.providers.slug is
  'The public profile''s address, /providers/<slug>. Made from the business name when the provider is created; fixed.';

-- ---------------------------------------------------------------------------
-- 2. Who can read and write them
-- ---------------------------------------------------------------------------

-- The provider edits their own profile (their own row, by the existing
-- providers_update_own policy). Not the slug.
grant update (headline, bio, avatar_path, avatar_small_path, cover_path, cover_card_path) on public.providers to authenticated;

-- Signed-out visitors: the profile's public columns, on the providers
-- providers_read_public already lets them read (active, with a visible
-- listing). Still never the owner, Stripe fields or status.
grant select (headline, bio, avatar_path, avatar_small_path, cover_path, cover_card_path, slug, city_id, created_at)
  on public.providers to anon;
comment on policy providers_read_public on public.providers is
  'Signed-out visitors can read active providers that have at least one visible listing. Column grants limit them to the public profile: id, display_name, headline, bio, the photos, slug, city_id and created_at.';

-- ---------------------------------------------------------------------------
-- 3. The provider-photos bucket
-- ---------------------------------------------------------------------------

-- Public read (profiles are public; file names are random). 5 MB, JPEG,
-- PNG or WebP. Files: <provider id>/avatar-<uuid>.webp and so on.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('provider-photos', 'provider-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy provider_photos_objects_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'provider-photos'
    and (storage.foldername(name))[1] = (select public.current_provider_id())::text
  );
comment on policy provider_photos_objects_insert_own on storage.objects is
  'Providers can upload profile photos only into their own folder of the provider-photos bucket.';

-- As for listing photos, these read rules also guard deletes (a delete only
-- reaches rows the caller may read). Visitors load photos by public URL.
create policy provider_photos_objects_read_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'provider-photos'
    and (storage.foldername(name))[1] = (select public.current_provider_id())::text
  );
comment on policy provider_photos_objects_read_own on storage.objects is
  'Providers can list and read the files in their own folder of the provider-photos bucket.';

create policy provider_photos_objects_read_admin
  on storage.objects for select to authenticated
  using (bucket_id = 'provider-photos' and (select public.is_admin()));
comment on policy provider_photos_objects_read_admin on storage.objects is
  'Admins can list and read every file in the provider-photos bucket.';

create policy provider_photos_objects_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'provider-photos'
    and (storage.foldername(name))[1] = (select public.current_provider_id())::text
  );
comment on policy provider_photos_objects_delete_own on storage.objects is
  'Providers can delete files in their own folder of the provider-photos bucket.';

create policy provider_photos_objects_delete_admin
  on storage.objects for delete to authenticated
  using (bucket_id = 'provider-photos' and (select public.is_admin()));
comment on policy provider_photos_objects_delete_admin on storage.objects is
  'Admins can delete any file in the provider-photos bucket.';

-- No update policy: a new photo is a new file.

-- ---------------------------------------------------------------------------
-- 4. Removing profile content that breaks the rules
-- ---------------------------------------------------------------------------

-- The profile rules (the same list as PROFILE_RULES in packages/types). The
-- admin chooses which one was broken; the provider's email names it.
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded',
  'retry_email', 'suspend_provider', 'reinstate_provider', 'remove_profile_content'));

alter table public.provider_emails drop constraint provider_emails_kind_check;
alter table public.provider_emails add constraint provider_emails_kind_check
  check (kind in ('provider_account_paused', 'provider_account_active', 'provider_profile_edited'));
alter table public.provider_emails
  add column removed text[] check (removed <@ array['avatar', 'cover', 'headline', 'bio']),
  -- Required for a profile removal (checked by the function and below).
  add column rule text check (rule in ('contact_details', 'private_information', 'abuse', 'impersonation', 'unsuitable_photo', 'not_yours'));
comment on column public.provider_emails.removed is 'For provider_profile_edited: which parts of the profile lokl removed.';
alter table public.provider_emails
  add constraint provider_emails_profile_edit_named check (kind <> 'provider_profile_edited' or (rule is not null and coalesce(array_length(removed, 1), 0) > 0));
comment on column public.provider_emails.rule is 'For provider_profile_edited: the profile rule they broke (PROFILE_RULES in packages/types).';

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
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
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
comment on function public.admin_remove_provider_profile_content(uuid, uuid, text[], text, text, text) is
  'Server only: removes parts of a provider''s profile (photo, cover, headline, bio) that break a profile rule, logs the admin action with its internal reason, and queues the provider''s email naming what was removed and the rule, in one transaction. Returns the removed photos'' files for the server to delete. Refuses an admin id that isn''t an admin''s.';
revoke execute on function public.admin_remove_provider_profile_content(uuid, uuid, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.admin_remove_provider_profile_content(uuid, uuid, text[], text, text, text) to service_role;
