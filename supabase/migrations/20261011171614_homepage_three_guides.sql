-- The homepage's guides become three at most (decided 2026-10-11): the main
-- guide alone as the hero (position 1), then, below "On lokl now", a guides
-- section with up to two cards (positions 2 and 3).
--
-- 1. Positions 4 and 5 are removed (the admin's choice, not a record: on
--    hosted, one row at position 4 when this was written), and the table
--    allows 1 to 3.
-- 2. admin_set_homepage_features keeps its signature (the admin app's call
--    doesn't change shape), takes at most three, and still takes the first
--    as the main guide, so cards can't be saved without one.
-- 3. public_homepage_guides shows nothing without a main guide: when the
--    main guide is unpublished or deleted (its row goes with it), the cards
--    are hidden until the admin chooses another, rather than the first card
--    quietly becoming the hero.

-- ---------------------------------------------------------------------------
-- 1. Three places
-- ---------------------------------------------------------------------------

delete from public.homepage_features where position > 3;
alter table public.homepage_features drop constraint homepage_features_position_check;
alter table public.homepage_features add constraint homepage_features_position_check check (position between 1 and 3);
comment on table public.homepage_features is
  'The guides on the homepage: position 1 is the main guide (the hero), 2 and 3 the guides section''s cards. Chosen by the admin; only published guides. Unpublishing or deleting a guide removes it; without a main guide, the cards aren''t shown.';
comment on column public.homepage_features.position is '1 is the main guide (the hero); 2 and 3 are the guides section''s two cards.';

-- ---------------------------------------------------------------------------
-- 2. The admin's choice, in one step
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
$$;
comment on function public.admin_set_homepage_features(uuid[]) is
  'Admins only: replaces the homepage guides with these, in this order, in one step: the first is the main guide, the others (up to two) the guides section''s cards. Each once, published only (the homepage_features trigger checks).';

-- ---------------------------------------------------------------------------
-- 3. What visitors get
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
  -- No main guide, no guides: the cards only show below one.
  where exists (
    select 1
    from public.homepage_features main
    join public.guides mg on mg.id = main.guide_id and mg.status = 'published'
    join public.cities mm on mm.id = mg.market_id and mm.active
    join public.guide_photos mp on mp.id = mg.cover_photo_id
    where main.position = 1
  )
$$;
comment on function public.public_homepage_guides() is
  'Everyone: the homepage''s guides in order (position 1 is the main guide, then the guides section''s cards), published only, with covers and teasers. Empty when there''s no main guide to show.';
