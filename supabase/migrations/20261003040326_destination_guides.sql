-- Destination guides (build step 7; docs/design/destination-guides.md,
-- reviewed 2026-10-03), part 1: the database.
--
-- A guide is an article about a place or theme in Atlanta that recommends
-- live lokl listings. Only the admin writes guides. Each has a draft copy
-- (what the editor edits) and a live copy (what visitors see); publishing
-- copies the draft over the live copy and keeps a version.
--
-- Access: admins read and write the guide tables directly (like categories
-- and cities), limited by column grants to the draft side. Only the server
-- changes a guide's status or its live copy, through publish_guide() and
-- unpublish_guide() (called by the admin app's publish routes). Visitors
-- read published guides through the website's server, which reads only the
-- live columns. homepage_features is readable by everyone.
--
-- Delete behaviour: a guide that was never published can be deleted, with its
-- photos and features; once published it's unpublished, never deleted.
-- Versions are kept. AI draft records outlive a deleted guide (the cost log).

-- ---------------------------------------------------------------------------
-- GUIDES
-- ---------------------------------------------------------------------------

create table public.guides (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.cities (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  -- The draft: what the editor edits.
  draft_title text not null default '' check (char_length(draft_title) <= 120),
  draft_teaser text not null default '' check (char_length(draft_teaser) <= 160),
  draft_body jsonb not null default '{"blocks": []}'::jsonb,
  draft_cover_photo_id uuid,
  -- What the listings block will show: at most one area and one category,
  -- and at least one of the two by the time it's published.
  draft_area_id uuid references public.service_areas (id) on delete restrict,
  draft_category_id uuid references public.categories (id) on delete restrict,
  draft_listing_kind text check (draft_listing_kind in ('service', 'experience')),
  -- The live copy: what visitors see. Written only by publish_guide().
  title text check (char_length(title) <= 120),
  teaser text check (char_length(teaser) <= 160),
  body jsonb,
  cover_photo_id uuid,
  -- The live listings block (copied from the draft at publish, so editing
  -- the draft doesn't change what visitors see).
  area_id uuid references public.service_areas (id) on delete restrict,
  category_id uuid references public.categories (id) on delete restrict,
  listing_kind text check (listing_kind in ('service', 'experience')),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  ai_draft_pending_review boolean not null default false,
  ai_reviewed_by uuid references auth.users (id) on delete set null,
  ai_reviewed_at timestamptz,
  published_at timestamptz,
  content_updated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guides_slug_unique unique (market_id, slug),
  constraint guides_published_has_content check (status = 'draft' or (title is not null and teaser is not null and body is not null and cover_photo_id is not null))
);
comment on table public.guides is
  'Destination guides: articles about a place or theme in a market that recommend live lokl listings. Admin-written. Draft columns are edited; live columns (title, teaser, body, cover_photo_id) are set only by publish_guide(). Visitors see published guides through the website''s server. Unpublished, never deleted, once published.';
comment on column public.guides.draft_body is 'The draft body as Editor.js blocks (JSON). Rendered by lokl''s own renderer, never as raw HTML.';
comment on column public.guides.area_id is
  'The live listings block''s area (with category_id and listing_kind): copied from the draft_ columns by publish_guide(), like the text and cover.';
comment on column public.guides.teaser is 'Up to 160 characters: shown under the photo on cards and the homepage, and used as the meta description.';
comment on column public.guides.ai_draft_pending_review is
  'True from the moment an AI draft lands in the draft until the admin confirms they''ve checked the highlighted phrases and the facts. Publishing is refused while true.';
comment on column public.guides.content_updated_at is
  'When the live text or cover last changed: "Last updated" on the page and dateModified in structured data.';

create trigger guides_set_updated_at before update on public.guides
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- GUIDE PHOTOS
-- ---------------------------------------------------------------------------

create table public.guide_photos (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides (id) on delete cascade,
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  card_path text unique check (card_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.card\.(jpg|webp)$'),
  width integer not null check (width between 1 and 2400),
  height integer not null check (height between 1 and 2400),
  alt_text text not null check (char_length(trim(alt_text)) between 1 and 200),
  source text not null check (source in ('own', 'unsplash', 'other')),
  credit_name text check (char_length(credit_name) <= 120),
  credit_url text check (credit_url ~ '^https://'),
  source_url text check (source_url ~ '^https://'),
  licence text check (char_length(licence) <= 120),
  commercial_use_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  -- Credits as each source asks (decided 2026-10-03).
  constraint guide_photos_unsplash_credit check (source <> 'unsplash' or (credit_name is not null and credit_url is not null and source_url is not null)),
  constraint guide_photos_other_credit check (source <> 'other' or (credit_name is not null and licence is not null and source_url is not null and commercial_use_confirmed))
);
comment on table public.guide_photos is
  'Photos of a guide, in the public guide-photos bucket under <guide id>/: resized in the browser (longest side at most 2,400px, metadata removed), with a ~600px card copy. Credits as the licence asks: none for own photos; "Photo by {name} on Unsplash" with links; or the credit, licence and source for another licence (commercial use confirmed).';

-- A photo's files are in its own guide's folder (the same safeguard as
-- listing photos), so a photo row can't point at another guide's files.
create or replace function public.guide_photos_in_own_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.storage_path not like new.guide_id::text || '/%'
     or (new.card_path is not null and new.card_path not like new.guide_id::text || '/%') then
    raise exception 'A guide''s photo has to be in that guide''s own folder.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.guide_photos_in_own_folder() is 'Trigger function: a guide photo''s files are in <its guide id>/.';
create trigger guide_photos_in_own_folder before insert or update of storage_path, card_path, guide_id on public.guide_photos
  for each row execute function public.guide_photos_in_own_folder();

alter table public.guides
  add constraint guides_draft_cover_fk foreign key (draft_cover_photo_id) references public.guide_photos (id) on delete set null,
  add constraint guides_cover_fk foreign key (cover_photo_id) references public.guide_photos (id) on delete restrict;

-- A guide's covers must be its own photos.
create or replace function public.guides_cover_is_own()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.draft_cover_photo_id is not null and not exists (
    select 1 from public.guide_photos where id = new.draft_cover_photo_id and guide_id = new.id) then
    raise exception 'The cover has to be one of this guide''s photos.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.guides_cover_is_own() is 'Trigger function: a guide''s cover is one of its own photos.';
create trigger guides_cover_is_own before insert or update of draft_cover_photo_id on public.guides
  for each row execute function public.guides_cover_is_own();

-- A guide's area is in its own market.
create or replace function public.guides_area_in_market()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.draft_area_id is not null and not exists (
    select 1 from public.service_areas where id = new.draft_area_id and city_id = new.market_id) then
    raise exception 'That area isn''t in this guide''s market.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.guides_area_in_market() is 'Trigger function: a guide''s area belongs to its market.';
create trigger guides_area_in_market before insert or update of draft_area_id, market_id on public.guides
  for each row execute function public.guides_area_in_market();

-- ---------------------------------------------------------------------------
-- THE GUIDE'S RULES
-- ---------------------------------------------------------------------------

-- What a signed-in admin may change directly; the rest is the server's.
create or replace function public.guides_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'A guide that has been published is unpublished, not deleted.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if (select auth.role()) = 'authenticated' and (new.status <> 'draft' or new.ai_draft_pending_review) then
      raise exception 'A new guide starts as a draft.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- A published guide's address is in search results: its slug stays.
  if old.published_at is not null and new.slug is distinct from old.slug then
    raise exception 'This guide has been published, so its address can''t change.' using errcode = 'check_violation';
  end if;
  if new.market_id is distinct from old.market_id then
    raise exception 'A guide stays in its market.' using errcode = 'check_violation';
  end if;
  -- Review: a signed-in admin can mark an AI draft reviewed, never mark it
  -- unreviewed (only a new AI draft does that, from the server).
  if old.ai_draft_pending_review and not new.ai_draft_pending_review then
    new.ai_reviewed_by := coalesce((select auth.uid()), new.ai_reviewed_by);
    new.ai_reviewed_at := now();
  elsif not old.ai_draft_pending_review and new.ai_draft_pending_review and (select auth.role()) = 'authenticated' then
    raise exception 'Only a new AI draft marks a guide as unreviewed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.guides_guard() is
  'Trigger function: a published guide keeps its slug and market and isn''t deleted; a new guide starts as a draft; an admin can mark an AI draft reviewed (recording who and when) but only the server marks it unreviewed.';
create trigger guides_guard before insert or update or delete on public.guides
  for each row execute function public.guides_guard();

-- ---------------------------------------------------------------------------
-- VERSIONS, AI DRAFTS, HOMEPAGE FEATURES
-- ---------------------------------------------------------------------------

create table public.guide_versions (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides (id) on delete restrict,
  title text not null,
  teaser text not null,
  body jsonb not null,
  cover_photo_id uuid references public.guide_photos (id) on delete set null,
  area_id uuid references public.service_areas (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  listing_kind text,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default clock_timestamp()
);
comment on table public.guide_versions is
  'A snapshot of a guide''s live copy each time it''s published, with who and when. Written by publish_guide(); read by admins.';
create index guide_versions_guide_idx on public.guide_versions (guide_id, published_at desc);

create table public.guide_ai_drafts (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid references public.guides (id) on delete set null,
  requested_by uuid references auth.users (id) on delete set null,
  topic text not null check (char_length(topic) <= 200),
  area_id uuid references public.service_areas (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  notes text check (char_length(notes) <= 4000),
  model text not null check (char_length(model) <= 80),
  reply jsonb,
  error text check (char_length(error) <= 1000),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(10, 4) check (cost_usd >= 0),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.guide_ai_drafts is
  'Every AI draft request: what was sent (topic, area, category, the admin''s notes), the model, the reply or error, tokens and cost, who and when. Written by the admin app''s server; read by admins. Kept if its guide is deleted (the cost log).';

create table public.homepage_features (
  position smallint primary key check (position between 1 and 5),
  guide_id uuid not null unique references public.guides (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.homepage_features is
  'The guides at the top of the homepage: position 1 is the hero, 2 to 5 the smaller cards. Chosen by the admin; only published guides. Unpublishing a guide removes it.';
comment on column public.homepage_features.position is '1 is the hero; 2 to 5 are the four smaller cards.';

create or replace function public.homepage_features_published_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.guides where id = new.guide_id and status = 'published') then
    raise exception 'Only a published guide can be on the homepage.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.homepage_features_published_only() is 'Trigger function: only published guides are featured on the homepage.';
create trigger homepage_features_published_only before insert or update on public.homepage_features
  for each row execute function public.homepage_features_published_only();

-- ---------------------------------------------------------------------------
-- PUBLISHING (the server only)
-- ---------------------------------------------------------------------------

-- The cover's minimum size (settled 2026-10-03): sharp as the homepage hero.
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
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
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
  if c.width < 2000 or c.height < 1125 or c.width <= c.height then
    raise exception 'The cover photo needs to be landscape and at least 2,000 by 1,125 pixels (this one is % by %).', c.width, c.height
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
comment on function public.publish_guide(uuid, uuid) is
  'Server only: publishes a guide''s draft (or publishes changes): checks the title, teaser, body, area or category, review and a cover of at least 2,000 x 1,125, copies the draft (text, cover and listings block) over the live copy, and keeps a version. Refuses an id that isn''t an admin''s.';

create or replace function public.unpublish_guide(p_guide_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Only an admin can unpublish a guide.' using errcode = 'insufficient_privilege';
  end if;
  update public.guides set status = 'unpublished' where id = p_guide_id and status = 'published';
  -- Off the homepage at once.
  delete from public.homepage_features where guide_id = p_guide_id;
end;
$$;
comment on function public.unpublish_guide(uuid, uuid) is
  'Server only: unpublishes a guide and takes it off the homepage. Refuses an id that isn''t an admin''s.';

-- Security definer (to check the admin in auth.users), so only the server may
-- call them.
revoke execute on function public.publish_guide(uuid, uuid), public.unpublish_guide(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_guide(uuid, uuid), public.unpublish_guide(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- WHO CAN READ AND WRITE
-- ---------------------------------------------------------------------------

alter table public.guides enable row level security;
alter table public.guide_photos enable row level security;
alter table public.guide_versions enable row level security;
alter table public.guide_ai_drafts enable row level security;
alter table public.homepage_features enable row level security;

revoke all on public.guides, public.guide_photos, public.guide_versions, public.guide_ai_drafts, public.homepage_features from anon, authenticated;
grant select on public.guides, public.guide_photos, public.guide_versions, public.guide_ai_drafts, public.homepage_features to authenticated;
grant select on public.homepage_features to anon;
-- Admins write the draft side only; status and the live copy are the server's.
grant insert (market_id, slug, draft_title, draft_teaser, draft_body, draft_cover_photo_id, draft_area_id, draft_category_id, draft_listing_kind)
  on public.guides to authenticated;
grant update (slug, draft_title, draft_teaser, draft_body, draft_cover_photo_id, draft_area_id, draft_category_id, draft_listing_kind, ai_draft_pending_review)
  on public.guides to authenticated;
grant delete on public.guides to authenticated;
grant insert, update (alt_text, source, credit_name, credit_url, source_url, licence, commercial_use_confirmed), delete on public.guide_photos to authenticated;
grant insert, update, delete on public.homepage_features to authenticated;

create policy guides_admin on public.guides for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
comment on policy guides_admin on public.guides is 'Admins read and write guides (the draft side, by the column grants). Visitors read published guides through the website''s server.';
create policy guide_photos_admin on public.guide_photos for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
comment on policy guide_photos_admin on public.guide_photos is 'Admins read and write guide photos.';
create policy guide_versions_read_admin on public.guide_versions for select to authenticated using ((select public.is_admin()));
comment on policy guide_versions_read_admin on public.guide_versions is 'Admins read the versions; publish_guide() writes them.';
create policy guide_ai_drafts_read_admin on public.guide_ai_drafts for select to authenticated using ((select public.is_admin()));
comment on policy guide_ai_drafts_read_admin on public.guide_ai_drafts is 'Admins read the AI draft log; the admin app''s server writes it.';
create policy homepage_features_read on public.homepage_features for select to anon, authenticated using (true);
comment on policy homepage_features_read on public.homepage_features is 'Everyone can read which guides are on the homepage (only published ones can be).';
create policy homepage_features_write_admin on public.homepage_features for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
comment on policy homepage_features_write_admin on public.homepage_features is 'Admins choose the homepage guides and their order.';

-- ---------------------------------------------------------------------------
-- STORAGE: the guide-photos bucket
-- ---------------------------------------------------------------------------

-- Public read (the photos appear on public pages; paths are unguessable).
-- 8 MB, JPEG, PNG or WebP. Admins upload into <guide id>/ and delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide-photos', 'guide-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']);

create policy guide_photos_objects_insert_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'guide-photos' and (select public.is_admin())
              and exists (select 1 from public.guides g where g.id::text = (storage.foldername(name))[1]));
comment on policy guide_photos_objects_insert_admin on storage.objects is 'Admins upload guide photos into the folder of an existing guide.';
create policy guide_photos_objects_read_admin on storage.objects for select to authenticated
  using (bucket_id = 'guide-photos' and (select public.is_admin()));
comment on policy guide_photos_objects_read_admin on storage.objects is 'Admins list and read the guide-photos bucket (also what lets them delete there).';
create policy guide_photos_objects_delete_admin on storage.objects for delete to authenticated
  using (bucket_id = 'guide-photos' and (select public.is_admin()));
comment on policy guide_photos_objects_delete_admin on storage.objects is 'Admins delete guide photos.';
