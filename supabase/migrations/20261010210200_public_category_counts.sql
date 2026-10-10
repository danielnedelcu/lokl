-- Category counts on a market page, counted by the database (truncation
-- sweep, 2026-10-10). The page read up to 1,000 visible listings and counted
-- them in code, so past 1,000 the counts were too low.
--
-- Security invoker: visitors' read rules decide which listings count.

create function public.public_category_counts(p_market_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.category_id, x.n), '{}'::jsonb)
  from (
    select l.category_id, count(*)::int as n
    from public.listings l
    where l.city_id = p_market_id and l.status = 'live'
    group by l.category_id
  ) x;
$$;

comment on function public.public_category_counts(uuid) is
  'Visible listings per category in a market, as {category_id: count}. Runs with the caller''s read rules. Called by the website''s market pages as a visitor.';

revoke execute on function public.public_category_counts(uuid) from public, service_role;
grant execute on function public.public_category_counts(uuid) to anon, authenticated;
