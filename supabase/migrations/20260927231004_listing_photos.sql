-- Listing photos and their storage bucket (build step 4 of
-- docs/design/categories-and-listings.md).
--
-- Files live in the public `listing-photos` bucket under
-- <provider_id>/<listing_id>/<random uuid>.<ext>; the browser uploads them
-- directly, then writes a listing_photos row. Deleting a row doesn't delete
-- the file; a cleanup job for orphaned files can come later.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- LISTING PHOTOS
-- ---------------------------------------------------------------------------

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  position smallint not null check (position between 0 and 7),
  alt_text text not null check (char_length(alt_text) between 5 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deferrable so reorder_listing_photos() can swap positions in one
  -- statement; checked immediately everywhere else.
  constraint listing_photos_listing_id_position_key unique (listing_id, position) deferrable initially immediate
);

comment on table public.listing_photos is
  'Photos of a listing, at most 8. Position 0 is the cover. At least one is required before a listing is published or submitted. Removed by the provider (not while submitted or unpublished, and never the last one of a live listing) or by the admin; rows go with their listing. Removing a row leaves the stored file.';
comment on column public.listing_photos.storage_path is
  'Path in the listing-photos bucket: <provider_id>/<listing_id>/<random uuid>.<ext>. Must be in this listing''s own folder.';
comment on column public.listing_photos.position is
  '0 to 7, unique per listing. 0 is the cover photo.';
comment on column public.listing_photos.alt_text is
  'Describes the photo for screen reader users. Required, 5 to 200 characters.';

create trigger listing_photos_set_updated_at
  before update on public.listing_photos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- LISTING PHOTOS: path, limit and status rules
-- ---------------------------------------------------------------------------

-- A row may only point at a file in its own listing's folder, so nobody can
-- attach another provider's file (or another listing's) to their listing.
create or replace function public.listing_photos_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_provider_id uuid;
begin
  select provider_id into v_provider_id from public.listings where id = new.listing_id;
  if v_provider_id is not null
     and new.storage_path not like v_provider_id::text || '/' || new.listing_id::text || '/%' then
    raise exception 'The photo must be uploaded to this listing''s own folder.' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT'
     and (select count(*) from public.listing_photos where listing_id = new.listing_id) >= 8 then
    raise exception 'A listing can have up to 8 photos. Remove one to add another.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.listing_photos_check() is
  'Trigger function: a photo''s file must be in its listing''s folder, and a listing has at most 8 photos.';

create trigger listing_photos_check
  before insert or update of storage_path, listing_id on public.listing_photos
  for each row execute function public.listing_photos_check();

-- Photos follow the listing's status, like the travel areas: providers change
-- them while it is a draft, rejected or live (the design allows photo edits
-- on live listings), never while submitted or unpublished. Nobody removes the
-- last photo of a live listing, since a listing can't be live without one.
-- The server isn't limited by the status locks.
create or replace function public.listing_photos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing_id uuid := coalesce(new.listing_id, old.listing_id);
  v_status text;
begin
  select status into v_status from public.listings where id = v_listing_id;
  if v_status is null then
    return coalesce(new, old);
  end if;

  if current_user = 'authenticated' and v_status in ('submitted', 'unpublished') then
    raise exception 'This listing''s photos can''t be changed while it is %.', v_status
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' and v_status = 'live'
     and not exists (select 1 from public.listing_photos where listing_id = v_listing_id and id <> old.id) then
    raise exception 'A live listing needs at least one photo. Add another photo first, or unlist it.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;
comment on function public.listing_photos_guard() is
  'Trigger function: providers change photos while a listing is a draft, rejected or live, never while submitted or unpublished; nobody removes the last photo of a live listing.';

create trigger listing_photos_guard
  before insert or update or delete on public.listing_photos
  for each row execute function public.listing_photos_guard();

-- ---------------------------------------------------------------------------
-- LISTINGS: a photo is required to publish or submit
-- ---------------------------------------------------------------------------

-- Checked in the database, not only in the routes, so every way a listing
-- goes live or into review is covered: publish, submit, and later the admin's
-- approve and restore.
create or replace function public.listings_require_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('live', 'submitted')
     and new.status is distinct from old.status
     and not exists (select 1 from public.listing_photos where listing_id = new.id) then
    raise exception using
      errcode = 'check_violation',
      message = case new.status
        when 'live' then 'Add at least one photo before publishing.'
        else 'Add at least one photo before sending it for review.'
      end;
  end if;
  return new;
end;
$$;
comment on function public.listings_require_photo() is
  'Trigger function: a listing needs at least one photo to go live or be submitted for review.';

create trigger listings_require_photo
  before update of status on public.listings
  for each row execute function public.listings_require_photo();

-- ---------------------------------------------------------------------------
-- LISTING PHOTOS: row access (RLS)
-- ---------------------------------------------------------------------------

alter table public.listing_photos enable row level security;

create policy listing_photos_read_public
  on public.listing_photos for select to anon, authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status = 'live'
                   and public.listing_parents_active(l.provider_id, l.category_id, l.city_id)));
comment on policy listing_photos_read_public on public.listing_photos is
  'Anyone can read the photos of visible listings.';

create policy listing_photos_read_own
  on public.listing_photos for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_photos_read_own on public.listing_photos is
  'Providers can read the photos of their own listings.';

create policy listing_photos_read_admin
  on public.listing_photos for select to authenticated
  using ((select public.is_admin()));
comment on policy listing_photos_read_admin on public.listing_photos is
  'Admins can read all listing photos.';

create policy listing_photos_insert_own
  on public.listing_photos for insert to authenticated
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_photos_insert_own on public.listing_photos is
  'Providers can add photos to their own listings.';

create policy listing_photos_update_own
  on public.listing_photos for update to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())))
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_photos_update_own on public.listing_photos is
  'Providers can change the alt text and order of their own listings'' photos.';

create policy listing_photos_delete_own
  on public.listing_photos for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_photos_delete_own on public.listing_photos is
  'Providers can remove photos from their own listings.';

create policy listing_photos_delete_admin
  on public.listing_photos for delete to authenticated
  using ((select public.is_admin()));
comment on policy listing_photos_delete_admin on public.listing_photos is
  'Admins can remove any listing photo.';

-- Only alt text and position change after upload; a different file is a new
-- photo (remove + add), which runs the path check.
revoke insert, update, delete on public.listing_photos from anon;
revoke update on public.listing_photos from authenticated;
grant update (alt_text, position) on public.listing_photos to authenticated;

-- ---------------------------------------------------------------------------
-- REORDERING
-- ---------------------------------------------------------------------------

-- Sets the order of a listing's photos in one transaction (a swap would break
-- the unique position rule halfway through a row-by-row update). Runs with
-- the caller's rights (not security definer), so RLS and the status guard
-- apply as usual. RLS alone would already stop another provider, but only as
-- a confusing "list every photo" error, so ownership is checked first.
create or replace function public.reorder_listing_photos(p_listing_id uuid, p_photo_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_updated int;
begin
  if not exists (select 1 from public.listings
                 where id = p_listing_id and provider_id = (select public.current_provider_id())) then
    raise exception 'You can only reorder the photos of your own listings.' using errcode = 'insufficient_privilege';
  end if;

  if (select count(*) from public.listing_photos where listing_id = p_listing_id)
     is distinct from coalesce(array_length(p_photo_ids, 1), 0) then
    raise exception 'List every photo of the listing exactly once.' using errcode = 'check_violation';
  end if;

  set constraints public.listing_photos_listing_id_position_key deferred;
  update public.listing_photos p
  set position = o.ordinality - 1
  from unnest(p_photo_ids) with ordinality as o (id, ordinality)
  where p.id = o.id and p.listing_id = p_listing_id;
  get diagnostics v_updated = row_count;

  if v_updated <> array_length(p_photo_ids, 1) then
    raise exception 'List every photo of the listing exactly once.' using errcode = 'check_violation';
  end if;
end;
$$;
comment on function public.reorder_listing_photos(uuid, uuid[]) is
  'Sets the order of a listing''s photos: the first id becomes the cover (position 0). Every photo must be listed once. Runs with the caller''s rights.';

revoke execute on function public.reorder_listing_photos(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_listing_photos(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- STORAGE: the listing-photos bucket
-- ---------------------------------------------------------------------------

-- Public read: paths are unguessable (random file names), so drafts aren't
-- exposed in practice (design: Photo storage). 5 MB, JPEG, PNG or WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- Uploads: only into <your provider id>/<one of your listings>/.
create policy listing_photos_objects_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select public.current_provider_id())::text
    and exists (select 1 from public.listings l
                where l.id::text = (storage.foldername(name))[2]
                  and l.provider_id = (select public.current_provider_id()))
  );
comment on policy listing_photos_objects_insert_own on storage.objects is
  'Providers can upload listing photos only into their own provider folder, under one of their own listings.';

-- These read rules also guard deletes. A delete that filters rows can only
-- reach rows the caller may read, so:
--   * without them, the Storage API's remove() silently deletes nothing, and
--   * loosening them (e.g. to the whole bucket) widens who can delete as well
--     as who can list, even with the delete rules below unchanged.
-- Don't loosen them. Visitors don't need them; they load photos through the
-- bucket's public URLs.
create policy listing_photos_objects_read_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select public.current_provider_id())::text
  );
comment on policy listing_photos_objects_read_own on storage.objects is
  'Providers can list and read the files in their own provider folder of the listing-photos bucket.';

create policy listing_photos_objects_read_admin
  on storage.objects for select to authenticated
  using (bucket_id = 'listing-photos' and (select public.is_admin()));
comment on policy listing_photos_objects_read_admin on storage.objects is
  'Admins can list and read every file in the listing-photos bucket.';

create policy listing_photos_objects_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select public.current_provider_id())::text
  );
comment on policy listing_photos_objects_delete_own on storage.objects is
  'Providers can delete files in their own provider folder of the listing-photos bucket.';

create policy listing_photos_objects_delete_admin
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and (select public.is_admin()));
comment on policy listing_photos_objects_delete_admin on storage.objects is
  'Admins can delete any file in the listing-photos bucket.';

-- No update policy: a file is never overwritten or renamed; a new photo is
-- a new file.
