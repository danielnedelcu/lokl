-- Destination guides: the cover's minimum size is now 1,600 x 900, landscape
-- (was 2,000 x 1,125; decided 2026-10-03, see docs/decisions.md). Photos in
-- the body still have no minimum.
--
-- publish_guide() is redefined with only the size check (and its message)
-- changed. Its grants are unchanged: create or replace keeps them (execute
-- for service_role only, revoked from public, anon and authenticated).

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
comment on function public.publish_guide(uuid, uuid) is
  'Server only: publishes a guide''s draft (or publishes changes): checks the title, teaser, body, area or category, review and a landscape cover of at least 1,600 x 900, copies the draft (text, cover and listings block) over the live copy, and keeps a version. Refuses an id that isn''t an admin''s.';
