-- Destination guides, part 4: what visitors read (docs/design/destination-
-- guides.md, Public pages and SEO; The homepage), and the admin's homepage
-- choice. Decided 2026-10-03: visitors read guides through these functions,
-- so "only the live copy of published guides" is enforced here, not by each
-- website route choosing the right columns.
--
-- Access:
-- - public_guides, public_guide and public_homepage_guides are callable by
--   everyone (anon and signed-in). They're security definer (visitors can't
--   read the guide tables), and they return only published guides in
--   active markets, and only their live copy: never a draft column, the AI
--   review fields, who created a guide, or photos the live copy doesn't use.
-- - admin_set_homepage_features replaces the homepage list in one step (so
--   the homepage is never briefly empty or half-reordered). It refuses
--   anyone but an admin; it runs as the caller, so the admin write policy on
--   homepage_features applies too, and the published-only trigger still
--   checks each guide.
--
-- Delete behaviour: functions only.

-- ---------------------------------------------------------------------------
-- A photo as visitors get it (the live copy's cover and body photos)
-- ---------------------------------------------------------------------------

create or replace function public.public_guide_photo_json(p public.guide_photos)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'path', p.storage_path, 'card_path', p.card_path, 'width', p.width, 'height', p.height,
    'alt', p.alt_text, 'source', p.source, 'credit_name', p.credit_name, 'credit_url', p.credit_url,
    'source_url', p.source_url, 'licence', p.licence
  )
$$;
comment on function public.public_guide_photo_json(public.guide_photos) is
  'A guide photo as visitors get it: where it is, its size, alt text and credit. Used by the public_guide* functions.';

-- ---------------------------------------------------------------------------
-- The guides index
-- ---------------------------------------------------------------------------

create or replace function public.public_guides(p_market text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when m.id is null then null else jsonb_build_object(
    'market', jsonb_build_object('name', m.name, 'slug', m.slug, 'state', m.state, 'timezone', m.timezone),
    'guides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', g.slug, 'title', g.title, 'teaser', g.teaser,
        'published_at', g.published_at, 'content_updated_at', g.content_updated_at,
        'cover', public.public_guide_photo_json(ph)
      ) order by g.content_updated_at desc, g.id)
      from public.guides g
      join public.guide_photos ph on ph.id = g.cover_photo_id
      where g.market_id = m.id and g.status = 'published'
    ), '[]'::jsonb)
  ) end
  from (select null) one
  left join public.cities m on m.slug = p_market and m.active
$$;
comment on function public.public_guides(text) is
  'Everyone: a market''s published guides (live copy only), most recently updated first, with their covers. Null if the market isn''t public.';

-- ---------------------------------------------------------------------------
-- One guide
-- ---------------------------------------------------------------------------

create or replace function public.public_guide(p_market text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', g.slug, 'title', g.title, 'teaser', g.teaser, 'body', g.body,
    'published_at', g.published_at, 'content_updated_at', g.content_updated_at,
    'market', jsonb_build_object('name', m.name, 'slug', m.slug, 'state', m.state, 'timezone', m.timezone),
    -- The live listings block.
    'listings', jsonb_build_object(
      'kind', g.listing_kind,
      'area', (select jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind) from public.service_areas a where a.id = g.area_id),
      'category', (select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'kind', c.kind) from public.categories c where c.id = g.category_id)
    ),
    'cover_photo_id', g.cover_photo_id,
    -- Only the photos the live copy uses: its cover and its body's photo blocks.
    'photos', coalesce((
      select jsonb_agg(public.public_guide_photo_json(ph))
      from public.guide_photos ph
      where ph.guide_id = g.id
        and (ph.id = g.cover_photo_id or ph.id::text in (
          select b -> 'data' ->> 'photoId' from jsonb_array_elements(coalesce(g.body -> 'blocks', '[]'::jsonb)) b
          where b ->> 'type' = 'photo'))
    ), '[]'::jsonb)
  )
  from public.guides g
  join public.cities m on m.id = g.market_id and m.active
  where m.slug = p_market and g.slug = p_slug and g.status = 'published'
$$;
comment on function public.public_guide(text, text) is
  'Everyone: one published guide''s live copy (text, body, listings block, dates) and the photos it uses, with their credits. Null for drafts, unpublished guides and markets that aren''t public.';

-- ---------------------------------------------------------------------------
-- The homepage
-- ---------------------------------------------------------------------------

create or replace function public.public_homepage_guides()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', hf.position, 'market', m.slug, 'slug', g.slug, 'title', g.title, 'teaser', g.teaser,
    'cover', public.public_guide_photo_json(ph)
  ) order by hf.position), '[]'::jsonb)
  from public.homepage_features hf
  join public.guides g on g.id = hf.guide_id and g.status = 'published'
  join public.cities m on m.id = g.market_id and m.active
  join public.guide_photos ph on ph.id = g.cover_photo_id
$$;
comment on function public.public_homepage_guides() is
  'Everyone: the homepage''s featured guides in order (position 1 is the hero), published only, with covers and teasers.';

-- ---------------------------------------------------------------------------
-- The admin's homepage choice, in one step
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_homepage_features(p_guide_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_guide_ids), 0) > 5 then
    raise exception 'The homepage shows up to 5 guides.' using errcode = 'check_violation';
  end if;
  if (select count(distinct x) from unnest(p_guide_ids) x) <> coalesce(cardinality(p_guide_ids), 0) then
    raise exception 'Each guide can be on the homepage once.' using errcode = 'check_violation';
  end if;
  delete from public.homepage_features where true;
  insert into public.homepage_features (position, guide_id)
  select n, id from unnest(p_guide_ids) with ordinality as t(id, n);
end;
$$;
comment on function public.admin_set_homepage_features(uuid[]) is
  'Admins only: replaces the homepage guides with these, in this order (the first is the hero), in one step. Up to 5, each once, published only (the homepage_features trigger checks).';

revoke execute on function public.public_guide_photo_json(public.guide_photos) from public, anon, authenticated;
revoke execute on function public.public_guides(text) from public;
revoke execute on function public.public_guide(text, text) from public;
revoke execute on function public.public_homepage_guides() from public;
revoke execute on function public.admin_set_homepage_features(uuid[]) from public, anon;
grant execute on function public.public_guides(text) to anon, authenticated;
grant execute on function public.public_guide(text, text) to anon, authenticated;
grant execute on function public.public_homepage_guides() to anon, authenticated;
grant execute on function public.admin_set_homepage_features(uuid[]) to authenticated;
