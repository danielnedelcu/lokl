-- Search orders dated Services by their exact first free time
-- (docs/design/service-availability.md; decided 2026-10-18). From the open
-- days table it used greatest(first_at, now() + notice): once the clock
-- passed a Service's stored first time (the table is refreshed when
-- something changes and daily, not as the clock moves), that was "now plus
-- the notice", not a time anyone could book, up to one slot early, so a
-- Service could be put ahead of one free sooner.
--
-- Each open day now keeps its free start times, from the same core and
-- the same call that already works out its first and last, and search
-- takes the earliest at or after now plus the notice: the panel's exact
-- time, with nothing worked out live. (Working the day out live instead
-- took 216 ms per search when most Services' stored first times had
-- passed, as they do through the day; this takes 10 to 17 ms.)
-- refresh_service_open_days and service_open_matches are otherwise
-- unchanged from 20261015230114_service_open_days.sql; their grants carry
-- over.

alter table public.service_open_days add column starts timestamptz[] not null default '{}';
comment on table public.service_open_days is
  'Each market day a Service has a bookable time, with its start times (and the first and last of them), as of its last refresh (service_open_days_refreshed). Worked out by the slot core; only refresh_service_open_days writes it. Search reads it through service_open_matches. Derived data: rewritten freely, and deleted with its listing.';
comment on column public.service_open_days.starts is
  'The day''s bookable start times when refreshed, in order (first_at is the first, last_at the last). Search takes the earliest at or after now plus the notice, the time the panel would show.';

create or replace function public.refresh_service_open_days(p_provider_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
  v_ids uuid[];
begin
  -- One provider at a time, in a fixed order, each under its own lock for
  -- the rest of the transaction: two bookings for one provider refresh one
  -- after the other (the second waits for the first to commit, then sees
  -- its hold), never both at once and never in a deadlock.
  for v_provider in select distinct p from unnest(p_provider_ids) p where p is not null order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('service_open_days:' || v_provider::text, 0));
    select array_agg(id) into v_ids from public.listings where provider_id = v_provider and kind = 'service';
    delete from public.service_open_days d using public.listings l
     where l.id = d.listing_id and l.provider_id = v_provider;
    delete from public.service_open_days_refreshed where provider_id = v_provider;
    continue when v_ids is null;
    -- Every Service's whole window (the core stops at each one's window).
    insert into public.service_open_days (listing_id, on_date, first_at, last_at, starts)
    select m.listing_id, (m.starts_at at time zone c.timezone)::date, min(m.starts_at), max(m.starts_at),
           array_agg(m.starts_at order by m.starts_at)
      from public.service_slots_many(v_ids, (now() at time zone 'UTC')::date - 1, (now() at time zone 'UTC')::date + 182, now(), true) m
      join public.listings l on l.id = m.listing_id
      join public.cities c on c.id = l.city_id
     group by 1, 2;
    insert into public.service_open_days_refreshed (listing_id, provider_id, refreshed_at, covered_through, notice)
    select l.id, v_provider, now(),
           (now() at time zone c.timezone)::date + coalesce(s.booking_window_days, 60),
           case when l.booking_mode = 'approve'
                then greatest(make_interval(mins => coalesce(s.min_notice_minutes, 1440)), interval '4 hours')
                else make_interval(mins => coalesce(s.min_notice_minutes, 1440)) end
      from public.listings l
      join public.cities c on c.id = l.city_id
      left join public.provider_schedules s on s.provider_id = l.provider_id
     where l.id = any (v_ids);
  end loop;
end;
$$;
comment on function public.refresh_service_open_days(uuid[]) is
  'Works out again the open days of every Service of these providers, over each one''s whole booking window, as of now, one provider at a time under a per-provider transaction lock. Called at commit for the providers a transaction changed (service_open_days_flush) and by the refresh-open-days job (server only).';

create or replace function public.service_open_matches(p_ids uuid[], p_from date, p_to date)
returns table (listing_id uuid, first_day date, first_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_ids is null or p_from is null or p_to is null or p_to < p_from then
    return;
  end if;
  if p_to - p_from > 200 then
    raise exception 'Ask for at most 200 days.' using errcode = 'invalid_parameter_value';
  end if;
  -- (No temporary table: search runs in a read-only transaction.)
  return query
  with ids as materialized (
    -- Only Services customers could book: live, with active parents. (A
    -- provider who can't be paid has no open days: the providers trigger
    -- refreshes them away, and the live part checks it itself.)
    select l.id, r.covered_through, r.notice,
           -- The last day it can be booked now (today plus its window).
           (now() at time zone c.timezone)::date + coalesce(s.booking_window_days, 60) as window_end
      from public.listings l
      join public.cities c on c.id = l.city_id
      left join public.provider_schedules s on s.provider_id = l.provider_id
      left join public.service_open_days_refreshed r on r.listing_id = l.id
     where l.id = any (p_ids) and l.kind = 'service' and l.status = 'live'
       -- Active parents, as visitors' read rule checks them (once per query).
       and l.provider_id in (select public.active_provider_ids())
       and l.category_id in (select public.active_category_ids())
       and l.city_id in (select public.active_city_ids())
  ),
  stored as (
    -- What the table covers: each Service's first day whose last time is
    -- still beyond the notice (one look-up in the primary key per Service),
    -- and its exact first time now: the earliest stored start at or after
    -- now plus the notice. The starts are the core's, as of the refresh;
    -- anything that changes them refreshes the table, so only the clock
    -- moves, and it only takes starts away.
    select i.id as listing_id, d.on_date, d.at
      from ids i
      cross join lateral (
        select d.on_date, (select min(x) from unnest(d.starts) x where x >= now() + i.notice) as at
          from public.service_open_days d
         where d.listing_id = i.id and d.on_date between p_from and least(p_to, i.covered_through)
           and d.last_at >= now() + i.notice
         order by d.on_date
         limit 1) d
  ),
  stale as (
    -- Days past what the table covers, or a Service never refreshed: live.
    select array_agg(i.id) as a, min(coalesce(i.covered_through + 1, p_from)) as f
      from ids i where i.covered_through is null or i.covered_through < least(p_to, i.window_end)
  ),
  tail as (
    select m.listing_id, (m.starts_at at time zone c.timezone)::date as on_date, m.starts_at as at
      from stale
      cross join lateral public.service_slots_many(stale.a, greatest(p_from, stale.f), p_to, now(), true) m
      join ids i on i.id = m.listing_id
      join public.listings l on l.id = m.listing_id
      join public.cities c on c.id = l.city_id
     where i.covered_through is null or (m.starts_at at time zone c.timezone)::date > i.covered_through
  )
  select distinct on (x.listing_id) x.listing_id, x.on_date, x.at
    from (select * from stored union all select * from tail) x
   order by x.listing_id, x.on_date, x.at;
end;
$$;

comment on function public.service_open_matches(uuid[], date, date) is
  'Of these Services, those customers can book on a market day between p_from and p_to (at most 200 days), each with its first such day and its exact first free time then (for ordering): from service_open_days where it covers the range (the earliest stored start at or after now plus the notice), and worked out live by the same core past that. For visitors and signed-in users (search runs as them).';

-- Every Service's open days again, now with their starts: each provider
-- with a Service, as the daily job would.
select public.refresh_service_open_days(array(select distinct provider_id from public.listings where kind = 'service'));

alter table public.service_open_days alter column starts drop default,
  add constraint service_open_days_starts check (cardinality(starts) >= 1 and starts[1] = first_at and starts[cardinality(starts)] = last_at);
