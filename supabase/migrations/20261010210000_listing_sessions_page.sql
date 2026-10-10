-- The provider's sessions panel, a page at a time (truncation sweep,
-- 2026-10-10). The panel read every booking on a listing, past sessions and
-- abandoned checkouts included, and added up seats and refunds in the
-- browser: past the API's 1,000 rows, some sessions showed wrong numbers.
-- This counts per session in the database, one page of upcoming or past
-- sessions at a time.
--
-- Security invoker: the caller's read rules decide which sessions and
-- bookings are counted (a provider: their own listing's; an admin: any).

create function public.listing_sessions_page(p_listing_id uuid, p_past boolean, p_page int default 1, p_page_size int default 50)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with s as (
    select es.id, es.starts_at, es.capacity, es.status
    from public.experience_sessions es
    where es.listing_id = p_listing_id
      and case when p_past then es.starts_at <= now() else es.starts_at > now() end
  ), numbered as (
    -- Upcoming soonest first; past most recent first.
    select s.*, row_number() over (
             order by case when p_past then null else s.starts_at end asc,
                      case when p_past then s.starts_at end desc,
                      s.id) as n
    from s
  ), page as (
    select * from numbered
    where n > (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
      and n <= greatest(p_page, 1) * least(greatest(p_page_size, 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from s),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'starts_at', p.starts_at, 'capacity', p.capacity, 'status', p.status,
               'booking_rows', b.booking_rows, 'booked', b.booked, 'refund_cents', b.refund_cents)
             order by p.n)
      from page p
      cross join lateral (
        select count(*)::int as booking_rows,
               coalesce(sum(bk.party_size) filter (where bk.status = 'confirmed'), 0)::int as booked,
               coalesce(sum(bk.total_cents) filter (where bk.status = 'confirmed'), 0)::int as refund_cents
        from public.bookings bk
        where bk.session_id = p.id
      ) b), '[]'::jsonb));
$$;

comment on function public.listing_sessions_page(uuid, boolean, int, int) is
  'One page (at most 100) of a listing''s upcoming (soonest first) or past (most recent first) sessions, each with its booking rows (any at all means it can''t be deleted), seats booked and the refund a cancellation would make (confirmed bookings), and the total. Runs with the caller''s read rules. Called by the provider''s sessions panel (signed-in users).';

revoke execute on function public.listing_sessions_page(uuid, boolean, int, int) from public, anon, service_role;
grant execute on function public.listing_sessions_page(uuid, boolean, int, int) to authenticated;
