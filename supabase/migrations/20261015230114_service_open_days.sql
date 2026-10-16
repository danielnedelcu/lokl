-- Service availability, phase 4 (docs/design/service-availability.md,
-- "Search"): dates filter Services too, by real availability. A Service
-- matches a date range when it has a bookable slot on a market day in it,
-- by exactly the rules the scheduling panel uses.
--
-- Measured first (2026-10-15, 1,000 live Services, local, as a visitor):
-- working out slots per Service on every search took 0.3 s for one day and
-- 1.7 s (5 s with ordering) for 31 days, so search reads a table of open
-- days instead, kept current when anything changes, with the same core
-- working out live whatever the table hasn't covered yet.
--
-- 1. One core for every slot question: service_slots_many works on many
--    Services at once; service_slots_core (the panel's, the preview's and
--    service_next_slot's) is now a wrapper around it.
-- 2. service_open_days: per Service and market day, its first and last
--    bookable time, refreshed once per provider per transaction, at commit,
--    for every change to slots (hours, date hours, time off, settings,
--    holds, the Service, the provider's payouts), under a per-provider lock.
-- 3. service_open_matches: the Services with a free time in a range, from
--    the table, and live (the same core) past what it covers.
-- 4. public_browse: dates filter Services; dated Services are ordered by
--    their first free time in the range; undated, Services with no free
--    time in their window come last (shown as "Not taking bookings yet").

-- ---------------------------------------------------------------------------
-- 1. ONE CORE, FOR ONE SERVICE OR MANY
-- ---------------------------------------------------------------------------

create function public.service_slots_many(p_ids uuid[], p_from date, p_to date, p_now timestamptz, p_require_bookable boolean)
returns table (listing_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with l as materialized (
    -- Each Service with a mode and a duration and its rules: market zone,
    -- booking window, notice (at least 4 hours for a Service the provider
    -- approves), slot interval, duration and buffer. For customers
    -- (p_require_bookable) only a live Service whose provider, category and
    -- city are active and whose provider can be paid.
    select l.id, l.provider_id, c.timezone as zone,
           coalesce(s.booking_window_days, 60) as win,
           case when l.booking_mode = 'approve'
                then greatest(make_interval(mins => coalesce(s.min_notice_minutes, 1440)), interval '4 hours')
                else make_interval(mins => coalesce(s.min_notice_minutes, 1440)) end as notice,
           make_interval(mins => coalesce(s.slot_interval_minutes, 30)) as step,
           make_interval(mins => l.duration_minutes) as dur,
           public.hold_buffer(l) as buf,
           (p_now at time zone c.timezone)::date as today
      from public.listings l
      join public.cities c on c.id = l.city_id
      left join public.provider_schedules s on s.provider_id = l.provider_id
     where l.id = any (p_ids) and l.kind = 'service'
       and l.booking_mode is not null and l.duration_minutes is not null
       and (not p_require_bookable or (
             l.status = 'live'
             and public.listing_parents_active(l.provider_id, l.category_id, l.city_id)
             and exists (select 1 from public.providers p where p.id = l.provider_id
                          and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) = 'ready')))
  ),
  days as (
    select l.id, l.provider_id, d::date as day
      from l
      cross join lateral generate_series(greatest(p_from, l.today)::timestamp, least(p_to, l.today + l.win)::timestamp, interval '1 day') d
  ),
  open as (
    -- A day's date hours, or else its weekly hours.
    select dy.id, dy.day, h.starts, h.ends
      from days dy join public.provider_date_hours h on h.provider_id = dy.provider_id and h.on_date = dy.day
    union all
    select dy.id, dy.day, w.starts, w.ends
      from days dy join public.provider_weekly_hours w on w.provider_id = dy.provider_id and w.weekday = extract(dow from dy.day)
     where not exists (select 1 from public.provider_date_hours h where h.provider_id = dy.provider_id and h.on_date = dy.day)
  ),
  candidates as (
    -- Each start, as a wall-clock time turned into an instant in the
    -- market's zone (a time skipped by the March clock change lands an hour
    -- later, and is kept once), and the end of its interval. None on time off.
    select distinct o.id, (t at time zone l.zone) as slot_start, ((o.day + o.ends) at time zone l.zone) as open_until
      from open o
      join l on l.id = o.id
      cross join lateral generate_series(o.day + o.starts, o.day + o.ends - l.dur, l.step) t
     where not exists (select 1 from public.provider_time_off x
                        where x.provider_id = l.provider_id and o.day between x.starts_on and x.ends_on)
  )
  select c.id, c.slot_start, c.slot_start + l.dur
    from candidates c
    join l on l.id = c.id
   where c.slot_start + l.dur <= c.open_until
     and c.slot_start >= p_now + l.notice
     and not exists (select 1 from public.provider_holds ph
                      where ph.provider_id = l.provider_id
                        and ph.during && tstzrange(c.slot_start, c.slot_start + l.dur + l.buf))
   order by 1, 2;
$$;

comment on function public.service_slots_many(uuid[], date, date, timestamptz, boolean) is
  'The one slot core: the slots of many Services between two market dates, as of p_now, by the same rules as service_slots (hours, date hours, time off, slot interval, duration, notice with 4 hours for Approve, booking window, holds with the buffer). With p_require_bookable, only Services customers can book. Called only by service_slots_core, the open-days refresh and service_open_matches (as their owner).';

-- Only the functions below call it (as its owner).
revoke execute on function public.service_slots_many(uuid[], date, date, timestamptz, boolean) from public, anon, authenticated, service_role;

-- The single-Service core keeps its signature, its 31-day limit and its
-- callers (service_slots_at, my_service_slots_preview, service_next_slot);
-- its rules now live in service_slots_many alone.
create or replace function public.service_slots_core(p_listing_id uuid, p_from date, p_to date, p_now timestamptz, p_require_bookable boolean)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'Ask for 1 to 31 days of times.' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select m.starts_at, m.ends_at
      from public.service_slots_many(array[p_listing_id], p_from, p_to, p_now, p_require_bookable) m
     order by 1;
end;
$$;

comment on function public.service_slots_core(uuid, date, date, timestamptz, boolean) is
  'The slots of one Service between two market dates (1 to 31 days), as of p_now: service_slots_many for that Service. Called only by service_slots_at, my_service_slots_preview and service_next_slot.';

-- ---------------------------------------------------------------------------
-- 2. OPEN DAYS, KEPT CURRENT
-- ---------------------------------------------------------------------------

create table public.service_open_days (
  listing_id uuid not null references public.listings (id) on delete cascade,
  on_date date not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  primary key (listing_id, on_date),
  check (last_at >= first_at)
);

comment on table public.service_open_days is
  'Each market day a Service has a bookable time, with the first and last of them, as of its last refresh (service_open_days_refreshed). Worked out by the slot core; only refresh_service_open_days writes it. Search reads it through service_open_matches. Derived data: rewritten freely, and deleted with its listing.';
comment on column public.service_open_days.last_at is
  'The day''s last bookable time when refreshed. Search checks it against now plus the notice, so a day whose times have all come within the notice no longer matches.';

create table public.service_open_days_refreshed (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  refreshed_at timestamptz not null,
  -- The last market day the refresh covered (today then, plus the window):
  -- later days are worked out live until the next refresh.
  covered_through date not null,
  notice interval not null
);

comment on table public.service_open_days_refreshed is
  'When each Service''s open days were last worked out, how far ahead they cover, and its notice then (search checks times against now plus it). Derived data: rewritten freely, and deleted with its listing.';

create index service_open_days_refreshed_provider on public.service_open_days_refreshed (provider_id);

-- Derived data for search: no API role writes either table. Admins may read
-- them (support); visitors see matches only through service_open_matches.
alter table public.service_open_days enable row level security;
alter table public.service_open_days_refreshed enable row level security;
create policy service_open_days_read_admin on public.service_open_days for select to authenticated
  using ((select public.is_admin()));
comment on policy service_open_days_read_admin on public.service_open_days is 'Admins read every Service''s open days.';
create policy service_open_days_refreshed_read_admin on public.service_open_days_refreshed for select to authenticated
  using ((select public.is_admin()));
comment on policy service_open_days_refreshed_read_admin on public.service_open_days_refreshed is 'Admins read when each Service''s open days were worked out.';
grant select on public.service_open_days, public.service_open_days_refreshed to authenticated;

create function public.refresh_service_open_days(p_provider_ids uuid[])
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
    insert into public.service_open_days (listing_id, on_date, first_at, last_at)
    select m.listing_id, (m.starts_at at time zone c.timezone)::date, min(m.starts_at), max(m.starts_at)
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

-- The triggers run it as its owner; the server's daily job calls it.
revoke execute on function public.refresh_service_open_days(uuid[]) from public, anon, authenticated;

-- The daily job (refresh-open-days): the providers whose open days are
-- oldest (or a live Service never worked out), a batch at a time, so each
-- day the window's newest day is covered and search needs no live part.
create function public.refresh_stale_service_open_days(p_limit int default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_more boolean;
begin
  select array_agg(provider_id order by oldest, provider_id) into v_ids
    from (
      select x.provider_id, min(x.at) as oldest
        from (select r.provider_id, r.refreshed_at as at from public.service_open_days_refreshed r
              union all
              select l.provider_id, '-infinity'::timestamptz from public.listings l
               where l.kind = 'service' and l.status = 'live'
                 and not exists (select 1 from public.service_open_days_refreshed r where r.listing_id = l.id)) x
       group by x.provider_id
      having min(x.at) < now() - interval '20 hours'
       order by 2, 1
       limit greatest(p_limit, 1) + 1) due;
  v_more := coalesce(array_length(v_ids, 1), 0) > greatest(p_limit, 1);
  v_ids := v_ids[1:greatest(p_limit, 1)];
  perform public.refresh_service_open_days(v_ids);
  return jsonb_build_object('refreshed', coalesce(array_length(v_ids, 1), 0), 'more_waiting', v_more);
end;
$$;

comment on function public.refresh_stale_service_open_days(int) is
  'The daily refresh-open-days job: refreshes up to p_limit providers whose open days are oldest (more than 20 hours old, or a live Service never worked out), oldest first; says how many, and whether more were waiting. Server only.';

revoke execute on function public.refresh_stale_service_open_days(int) from public, anon, authenticated;

-- Changes are recorded, then refreshed once per provider per transaction,
-- at commit: a weekly series of 52 sessions holds 52 times (each hold is its
-- own statement inside the sessions trigger), and refreshing for each took
-- 1.4 s (measured 2026-10-15). The statement triggers note the providers in
-- service_open_days_pending; a deferred trigger on it refreshes them all,
-- in a fixed order, when the transaction commits.
create table public.service_open_days_pending (
  txid xid8 not null default pg_current_xact_id(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  primary key (txid, provider_id)
);

comment on table public.service_open_days_pending is
  'Providers whose open days a transaction changed, refreshed (and the rows deleted) when it commits. Empty between transactions; derived data.';

alter table public.service_open_days_pending enable row level security;
create policy service_open_days_pending_read_admin on public.service_open_days_pending for select to authenticated
  using ((select public.is_admin()));
comment on policy service_open_days_pending_read_admin on public.service_open_days_pending is 'Admins read pending refreshes (none between transactions).';
grant select on public.service_open_days_pending to authenticated;

-- One trigger function for every table that changes slots: the statement's
-- changed rows (transition table "changed"), the provider column named in
-- the trigger's argument, noted once per transaction.
create function public.service_open_days_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('insert into public.service_open_days_pending (provider_id)
                  select distinct %I from changed where %1$I is not null
                  on conflict do nothing', tg_argv[0]);
  return null;
end;
$$;

comment on function public.service_open_days_changed() is
  'Trigger function: notes the providers whose rows a statement changed (the provider column is the trigger''s argument), for one refresh at commit.';

revoke execute on function public.service_open_days_changed() from public, anon, authenticated, service_role;

create function public.service_open_days_flush()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- The first of the transaction's pending rows to fire refreshes them all,
  -- in provider order (so two transactions never lock providers in opposite
  -- orders); the rest find nothing left.
  with gone as (
    delete from public.service_open_days_pending where txid = pg_current_xact_id() returning provider_id
  )
  select array_agg(provider_id order by provider_id) into v_ids from gone;
  if v_ids is not null then
    perform public.refresh_service_open_days(v_ids);
  end if;
  return null;
end;
$$;

comment on function public.service_open_days_flush() is
  'Trigger function (deferred, at commit): refreshes the open days of every provider this transaction changed, once each.';

revoke execute on function public.service_open_days_flush() from public, anon, authenticated, service_role;

create constraint trigger service_open_days_pending_refresh
  after insert on public.service_open_days_pending
  deferrable initially deferred
  for each row execute function public.service_open_days_flush();

do $$
declare
  t record;
begin
  -- Tables whose every change can change slots, and their provider column.
  for t in select * from (values
      ('provider_weekly_hours', 'provider_id'), ('provider_date_hours', 'provider_id'),
      ('provider_time_off', 'provider_id'), ('provider_schedules', 'provider_id'),
      ('provider_holds', 'provider_id')) v(tbl, col)
  loop
    execute format('create trigger %I after insert on public.%I referencing new table as changed for each statement execute function public.service_open_days_changed(%L)',
                   t.tbl || '_open_days_insert', t.tbl, t.col);
    execute format('create trigger %I after update on public.%I referencing new table as changed for each statement execute function public.service_open_days_changed(%L)',
                   t.tbl || '_open_days_update', t.tbl, t.col);
    execute format('create trigger %I after delete on public.%I referencing old table as changed for each statement execute function public.service_open_days_changed(%L)',
                   t.tbl || '_open_days_delete', t.tbl, t.col);
  end loop;
end;
$$;

-- A Service's own rules, and whether customers can book it at all. (Column
-- lists aren't allowed with transition tables, so every update counts; a
-- listing edit that changes nothing here costs one refresh.)
create trigger listings_open_days_update
  after update on public.listings referencing new table as changed
  for each statement execute function public.service_open_days_changed('provider_id');
create trigger providers_open_days_update
  after update on public.providers referencing new table as changed
  for each statement execute function public.service_open_days_changed('id');

-- ---------------------------------------------------------------------------
-- 3. MATCHES: THE TABLE, AND LIVE PAST IT
-- ---------------------------------------------------------------------------

create function public.service_open_matches(p_ids uuid[], p_from date, p_to date)
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
    -- still beyond the notice (one look-up in the primary key per Service).
    select i.id as listing_id, d.on_date, greatest(d.first_at, now() + i.notice) as at
      from ids i
      cross join lateral (
        select d.on_date, d.first_at from public.service_open_days d
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
  'Of these Services, those customers can book on a market day between p_from and p_to (at most 200 days), each with its first such day and, roughly, its first free time then (for ordering): from service_open_days where it covers the range, checked against now plus the notice, and worked out live by the same core past that. For visitors and signed-in users (search runs as them).';

grant execute on function public.service_open_matches(uuid[], date, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. BROWSE AND SEARCH: DATES FILTER SERVICES TOO
-- ---------------------------------------------------------------------------

create or replace function public.public_browse(
  p_market text, p_kind text, p_category text default null, p_area uuid default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_page int default 1, p_page_size int default 24
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with market as (
    select c.timezone,
           (now() at time zone c.timezone)::date as today,
           (p_from at time zone c.timezone)::date as from_day,
           -- p_to is the midnight after the last day.
           ((p_to - interval '1 microsecond') at time zone c.timezone)::date as to_day
      from public.cities c where c.slug = p_market
  ),
  base as (
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
      -- Experience dates: a session from p_from, before p_to.
      and (p_kind <> 'experience' or (p_from is null and p_to is null)
           or exists (select 1 from public.experience_sessions s
                       where s.listing_id = l.id and s.status = 'scheduled' and s.starts_at > now()
                         and (p_from is null or s.starts_at >= p_from) and (p_to is null or s.starts_at < p_to)))
  ),
  -- Services: a free time on a market day in the range; with no dates,
  -- anywhere in their window (those with none are listed last).
  matches as (
    select m.* from market,
      public.service_open_matches(
        case when p_kind = 'service' then (select array_agg(id) from base) end,
        coalesce(market.from_day, market.to_day, market.today),
        coalesce(market.to_day, market.from_day, market.today + 181)) m
  ),
  l as (
    select b.*, m.first_day, m.first_at, (m.listing_id is not null) as open
      from base b left join matches m on m.listing_id = b.id
     where p_kind <> 'service' or (p_from is null and p_to is null) or m.listing_id is not null
  ),
  numbered as (
    -- Experiences: soonest next session first, those with none last.
    -- Services with dates: soonest free time in the range, then title.
    -- Services without: those taking bookings first, newest first.
    select l.id, l.first_day, l.open, row_number() over (
             order by case when p_kind = 'experience' then l.next_at end asc nulls last,
                      case when p_kind = 'experience' then l.title end asc,
                      case when p_kind = 'service' and (p_from is not null or p_to is not null) then l.first_at end asc,
                      case when p_kind = 'service' and (p_from is not null or p_to is not null) then l.title end asc,
                      case when p_kind = 'service' and p_from is null and p_to is null then not l.open end asc,
                      case when p_kind <> 'experience' then l.created_at end desc,
                      l.id) as n
    from l
  ),
  page as (
    select * from numbered n
     where n.n > (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
       and n.n <= greatest(p_page, 1) * least(greatest(p_page_size, 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from l),
    'ids', coalesce((select jsonb_agg(p.id order by p.n) from page p), '[]'::jsonb),
    -- Services on this page with no free time in their window (undated only).
    'closed', coalesce((select jsonb_agg(p.id) from page p
                         where p_kind = 'service' and p_from is null and p_to is null and not p.open), '[]'::jsonb),
    -- Services on this page: their first free day in the searched range.
    'firstDays', coalesce((select jsonb_object_agg(p.id, p.first_day) from page p
                            where p_kind = 'service' and (p_from is not null or p_to is not null)), '{}'::jsonb));
$$;

comment on function public.public_browse(text, text, text, uuid, timestamptz, timestamptz, int, int) is
  'One page (at most 100) of visible listing ids for a browse page, in browse order, with the total. Filters: category slug, area (own or travel), and dates: for Experiences a session between two times, for Services a free time on a market day between them (service_open_matches). Order: Experiences soonest next session first; Services with dates soonest free time in the range, then title; Services without, those taking bookings first, then newest. Also returns the page''s Services with no free time in their window ("closed", undated) and each Service''s first free day in the range ("firstDays", dated). Runs with the caller''s read rules. Called by the website''s browse pages, search, guides and sitemap, as a visitor or a signed-in visitor.';

-- (Its grants are unchanged: create or replace keeps them.)

-- ---------------------------------------------------------------------------
-- 5. FILL THE TABLE NOW
-- ---------------------------------------------------------------------------

select public.refresh_service_open_days(array_agg(distinct provider_id))
  from public.listings where kind = 'service';
