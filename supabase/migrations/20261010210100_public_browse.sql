-- Browse pages, a page at a time (truncation sweep, 2026-10-10). Browse read
-- up to 1,000 live listings per market and kind, then filtered, sorted,
-- counted and paged in code: past 1,000, listings were missing and the
-- total and order were wrong. This picks one page of listing ids, in order,
-- with the total; the server then loads those listings' cards.
--
-- Security invoker: visitors' read rules decide what's visible, exactly as
-- for the cards themselves.

create function public.public_browse(
  p_market text, p_kind text, p_category text default null, p_area uuid default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_page int default 1, p_page_size int default 24
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (
    select l.id, l.title, l.created_at,
           -- "scheduled" lets the (listing_id, starts_at) index for
           -- scheduled sessions answer this; visitors' read rule adds it too.
           (select min(s.starts_at) from public.experience_sessions s
             where s.listing_id = l.id and s.status = 'scheduled' and s.starts_at > now()) as next_at
    from public.listings l
    join public.cities c on c.id = l.city_id
    join public.categories cat on cat.id = l.category_id
    where l.kind = p_kind and l.status = 'live' and c.slug = p_market
      and (p_category is null or cat.slug = p_category)
      -- An area: the listing's own, or one it travels to.
      and (p_area is null or l.area_id = p_area
           or exists (select 1 from public.listing_service_areas a where a.listing_id = l.id and a.service_area_id = p_area))
      -- Dates (Experiences only): a session from p_from, before p_to.
      and (p_kind <> 'experience' or (p_from is null and p_to is null)
           or exists (select 1 from public.experience_sessions s
                       where s.listing_id = l.id and s.status = 'scheduled' and s.starts_at > now()
                         and (p_from is null or s.starts_at >= p_from) and (p_to is null or s.starts_at < p_to)))
  ), numbered as (
    -- Experiences: soonest next session first, those with none last.
    -- Services: newest first.
    select l.id, row_number() over (
             order by case when p_kind = 'experience' then l.next_at end asc nulls last,
                      case when p_kind = 'experience' then l.title end asc,
                      case when p_kind <> 'experience' then l.created_at end desc,
                      l.id) as n
    from l
  )
  select jsonb_build_object(
    'total', (select count(*) from l),
    'ids', coalesce((
      select jsonb_agg(n.id order by n.n) from numbered n
      where n.n > (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
        and n.n <= greatest(p_page, 1) * least(greatest(p_page_size, 1), 100)), '[]'::jsonb));
$$;

comment on function public.public_browse(text, text, text, uuid, timestamptz, timestamptz, int, int) is
  'One page (at most 100) of visible listing ids for a browse page, in browse order (Experiences: soonest next session first; Services: newest first), with the total. Filters: category slug, area (own or travel), and for Experiences a session between two times. Runs with the caller''s read rules. Called by the website''s browse pages, guides and sitemap as a visitor, and by signed-in visitors.';

revoke execute on function public.public_browse(text, text, text, uuid, timestamptz, timestamptz, int, int) from public, service_role;
grant execute on function public.public_browse(text, text, text, uuid, timestamptz, timestamptz, int, int) to anon, authenticated;
