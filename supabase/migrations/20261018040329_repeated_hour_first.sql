-- November's repeated hour offers the first occurrence (docs/design/
-- service-availability.md: "offered once (the first)"). On the day the
-- clocks go back, 1:00 to 1:59 AM happens twice; Postgres turns such a
-- wall-clock time into the later, standard-time instant, so the slots were
-- the repeated hour's (1:00 AM EST), not the first (1:00 AM EDT) as
-- designed. wall_clock_instant picks the first; every other time, and
-- March's skipped hour, are as before. service_slots_many is otherwise
-- unchanged (decided 2026-10-18).

create function public.wall_clock_instant(p_local timestamp, p_zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  -- The earlier instant (an hour earlier, still the same wall-clock time)
  -- when the time happens twice; otherwise Postgres's own answer. Checking
  -- that it reads back as the same time keeps March's skipped hour as it was.
  select case
    when ((p_local - interval '1 hour') at time zone p_zone) + interval '1 hour' < (p_local at time zone p_zone)
     and ((((p_local - interval '1 hour') at time zone p_zone) + interval '1 hour') at time zone p_zone) = p_local
    then ((p_local - interval '1 hour') at time zone p_zone) + interval '1 hour'
    else p_local at time zone p_zone
  end;
$$;
comment on function public.wall_clock_instant(timestamp, text) is
  'A wall-clock time in a zone, as an instant: for a time that happens twice (the hour repeated when the clocks go back), the first one; otherwise as Postgres reads it (a skipped time lands an hour later).';
-- Used only inside service_slots_many (as its owner): no API role calls it.
revoke execute on function public.wall_clock_instant(timestamp, text) from public, anon, authenticated;

create or replace function public.service_slots_many(p_ids uuid[], p_from date, p_to date, p_now timestamptz, p_require_bookable boolean)
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
    -- later, and is kept once; a time repeated in November is the first,
    -- daylight one: wall_clock_instant), and the end of its interval. None
    -- on time off.
    select distinct o.id, public.wall_clock_instant(t, l.zone) as slot_start, ((o.day + o.ends) at time zone l.zone) as open_until
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

-- A clash names the session's time; in the repeated hour it also names
-- which one ("1:30 AM EDT" or "1:30 AM EST"), as the apps show it
-- (repeatedHourZone in @repo/types). session_time_label writes it without
-- changing any session setting (decided 2026-10-18: a caller that catches
-- the error mustn't be left on another zone). The first of the two times
-- is daylight time (its offset is an hour more than the second's). The
-- name is the zone's current abbreviation from pg_timezone_names ("EDT" or
-- "EST"), or the same with D and S swapped for the other half of the year,
-- kept only if pg_timezone_abbrevs gives it exactly that offset and
-- daylight flag (so London's BST never becomes "BDT"); otherwise the
-- offset ("GMT+1", "GMT"), as the browser shows it.
create function public.session_time_label(p_at timestamptz, p_zone text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone p_zone;
  v_label text := to_char(v_local, 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM');
  v_daylight boolean;
  v_offset interval;
  v_abbrev text;
begin
  if (p_at - interval '1 hour') at time zone p_zone <> v_local
     and (p_at + interval '1 hour') at time zone p_zone <> v_local then
    return v_label;
  end if;
  v_daylight := (p_at + interval '1 hour') at time zone p_zone = v_local;
  v_offset := v_local - (p_at at time zone 'UTC');
  select case when n.is_dst = v_daylight then n.abbrev
              else regexp_replace(n.abbrev, '^([A-Z]+)[DS]T$', '\1' || case when v_daylight then 'D' else 'S' end || 'T') end
    into v_abbrev
    from pg_catalog.pg_timezone_names n where n.name = p_zone;
  if not exists (select 1 from pg_catalog.pg_timezone_abbrevs a
                  where a.abbrev = v_abbrev and a.utc_offset = v_offset and a.is_dst = v_daylight) then
    v_abbrev := 'GMT' || case when v_offset = interval '0' then ''
      else case when v_offset < interval '0' then '-' else '+' end
        || abs(extract(hour from v_offset))::int
        || case when extract(minute from v_offset) <> 0
                then ':' || lpad(abs(extract(minute from v_offset))::int::text, 2, '0') else '' end end;
  end if;
  return v_label || ' ' || v_abbrev;
end;
$$;
comment on function public.session_time_label(timestamptz, text) is
  'A session''s start in its zone, for messages: "Sunday, November 1, 2026 at 1:30 AM", with "EDT" or "EST" (or the offset, "GMT+1") added only in the hour that repeats when the clocks go back. Changes no session setting.';
-- Called by experience_sessions_check, an ordinary trigger that runs as
-- whoever writes a session: providers (authenticated) and the server.
revoke execute on function public.session_time_label(timestamptz, text) from public, anon;
grant execute on function public.session_time_label(timestamptz, text) to authenticated;

-- Otherwise unchanged from 20260928002703_experience_sessions.sql.
create or replace function public.experience_sessions_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if exists (select 1 from public.listings where id = new.listing_id and kind <> 'experience') then
    raise exception 'Only Experiences have sessions.' using errcode = 'check_violation';
  end if;

  if new.status = 'scheduled' and exists (
    select 1 from public.experience_sessions
    where listing_id = new.listing_id and starts_at = new.starts_at
      and status = 'scheduled' and id <> new.id
  ) then
    select c.timezone into v_timezone
    from public.listings l join public.cities c on c.id = l.city_id
    where l.id = new.listing_id;
    raise exception 'There''s already a session on %.', public.session_time_label(new.starts_at, coalesce(v_timezone, 'UTC'))
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;
comment on function public.experience_sessions_check() is
  'Trigger function: sessions belong to Experiences only, and two scheduled sessions of one Experience can''t start at the same time.';
