-- Service availability, phase 2 (docs/design/service-availability.md):
-- the provider's Availability page and each Service's settings.
--
-- 1. Every Service has a booking mode (chosen by the provider, no default)
--    and a duration of 15 minutes to 12 hours. The hosted test data already
--    complies (1 Service: approve, in range; counted 2026-10-15).
-- 2. Saving weekly hours, or one date's hours, replaces the provider's rows
--    in one step, under their row rules: an overlap refuses the whole save.
-- 3. The provider's own slot preview, for a draft or before payouts are set
--    up, from the same core as customers' slots, so the two can't drift.
--    Services the provider approves need at least 4 hours' notice in that
--    core (decided 2026-10-15), so customers are never offered a slot
--    create_service_booking would refuse.

-- ---------------------------------------------------------------------------
-- 1. EVERY SERVICE HAS A MODE AND A DURATION
-- ---------------------------------------------------------------------------

alter table public.listings
  add constraint listings_service_has_mode check (kind <> 'service' or booking_mode is not null),
  -- (is not null: a check passes when it's unknown, and null between… is unknown)
  add constraint listings_service_duration check (kind <> 'service' or (duration_minutes is not null and duration_minutes between 15 and 720));

comment on column public.listings.booking_mode is
  'Services: instant (booked and paid from a slot) or approve (a slot requested, the card held, the provider accepts or declines). Required on every Service, chosen by the provider (no default); can change while live (bookings keep the mode they were made under). Null on Experiences.';

-- ---------------------------------------------------------------------------
-- 2. SAVING HOURS IN ONE STEP
-- ---------------------------------------------------------------------------

-- The "ends after it starts" checks get names that say so, so the save
-- functions can tell them from any other check.
alter table public.provider_weekly_hours rename constraint provider_weekly_hours_check to provider_weekly_hours_ends_after_starts;
alter table public.provider_date_hours rename constraint provider_date_hours_check to provider_date_hours_ends_after_starts;

create function public.replace_weekly_hours(p_hours jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_provider uuid := public.current_provider_id();
  v_count integer;
  v_constraint text;
begin
  if v_provider is null then
    raise exception 'Set up your business first.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.provider_weekly_hours where provider_id = v_provider;
  insert into public.provider_weekly_hours (provider_id, weekday, starts, ends)
  select v_provider, (h ->> 'weekday')::smallint, (h ->> 'starts')::time, (h ->> 'ends')::time
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h;
  get diagnostics v_count = row_count;
  return v_count;
exception
  when exclusion_violation then
    raise exception 'Two of the hours on one day overlap.' using errcode = 'exclusion_violation';
  when check_violation then
    -- Only the end-before-start check gets that message; any other says
    -- something general.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint in ('provider_weekly_hours_ends_after_starts', 'provider_date_hours_ends_after_starts') then
      raise exception 'Each set of hours ends after it starts.' using errcode = 'check_violation';
    end if;
    raise exception 'Those hours couldn''t be saved.' using errcode = 'check_violation';
end;
$$;

comment on function public.replace_weekly_hours(jsonb) is
  'The signed-in provider''s weekly hours, replaced in one step from [{weekday, starts, ends}] (wall-clock times, market time): all saved, or none if two overlap or one ends before it starts. Runs under the provider''s own row rules. For signed-in users.';

create function public.replace_date_hours(p_date date, p_hours jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_provider uuid := public.current_provider_id();
  v_count integer;
  v_constraint text;
begin
  if v_provider is null then
    raise exception 'Set up your business first.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.provider_date_hours where provider_id = v_provider and on_date = p_date;
  insert into public.provider_date_hours (provider_id, on_date, starts, ends)
  select v_provider, p_date, (h ->> 'starts')::time, (h ->> 'ends')::time
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h;
  get diagnostics v_count = row_count;
  return v_count;
exception
  when exclusion_violation then
    raise exception 'Two of the hours on this date overlap.' using errcode = 'exclusion_violation';
  when check_violation then
    -- Only the end-before-start check gets that message; any other says
    -- something general.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint in ('provider_weekly_hours_ends_after_starts', 'provider_date_hours_ends_after_starts') then
      raise exception 'Each set of hours ends after it starts.' using errcode = 'check_violation';
    end if;
    raise exception 'Those hours couldn''t be saved.' using errcode = 'check_violation';
end;
$$;

comment on function public.replace_date_hours(date, jsonb) is
  'The signed-in provider''s hours for one date, replaced in one step from [{starts, ends}]; an empty list goes back to the weekly hours. All saved or none. Runs under the provider''s own row rules. For signed-in users.';

-- Called by signed-in providers (their row rules decide the rows); not the
-- server, not visitors.
grant execute on function public.replace_weekly_hours(jsonb), public.replace_date_hours(date, jsonb) to authenticated;
revoke execute on function public.replace_weekly_hours(jsonb), public.replace_date_hours(date, jsonb) from service_role;

-- ---------------------------------------------------------------------------
-- 3. SLOTS: ONE CORE, FOR CUSTOMERS AND THE PROVIDER'S PREVIEW
-- ---------------------------------------------------------------------------

create function public.service_slots_core(p_listing_id uuid, p_from date, p_to date, p_now timestamptz, p_require_bookable boolean)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_zone text;
  v_today date;
  v_window smallint;
  v_notice interval;
  v_step interval;
  v_duration interval;
  v_buffer interval;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'Ask for 1 to 31 days of times.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_listing from public.listings where id = p_listing_id;
  -- A Service with a mode and a duration has slots. For customers
  -- (p_require_bookable) it must also be live, with its provider, category
  -- and city active and its provider able to be paid; the provider's own
  -- preview skips that. Anything else has none (and says nothing about why).
  if v_listing.id is null or v_listing.kind <> 'service'
     or v_listing.booking_mode is null or v_listing.duration_minutes is null then
    return;
  end if;
  if p_require_bookable and (v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id)
     or not exists (select 1 from public.providers p where p.id = v_listing.provider_id
                     and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) = 'ready')) then
    return;
  end if;
  select c.timezone into v_zone from public.cities c where c.id = v_listing.city_id;
  select coalesce(s.booking_window_days, 60), make_interval(mins => coalesce(s.min_notice_minutes, 1440)),
         make_interval(mins => coalesce(s.slot_interval_minutes, 30))
    into v_window, v_notice, v_step
    from (select 1) one left join public.provider_schedules s on s.provider_id = v_listing.provider_id;
  -- Services the provider approves need at least 4 hours (time to answer,
  -- as create_service_booking requires), whatever the provider's notice.
  if v_listing.booking_mode = 'approve' then
    v_notice := greatest(v_notice, interval '4 hours');
  end if;
  v_today := (p_now at time zone v_zone)::date;
  v_duration := make_interval(mins => v_listing.duration_minutes);
  v_buffer := public.hold_buffer(v_listing);

  return query
  with days as (
    select d::date as day
      from generate_series(greatest(p_from, v_today)::timestamp, least(p_to, v_today + v_window)::timestamp, interval '1 day') d
  ),
  dated as (
    select dy.day, h.starts, h.ends
      from days dy join public.provider_date_hours h on h.provider_id = v_listing.provider_id and h.on_date = dy.day
  ),
  open as (
    select * from dated
    union all
    select dy.day, w.starts, w.ends
      from days dy join public.provider_weekly_hours w
        on w.provider_id = v_listing.provider_id and w.weekday = extract(dow from dy.day)
     where not exists (select 1 from dated where dated.day = dy.day)
  ),
  candidates as (
    -- Each start, as a wall-clock time turned into an instant in the
    -- market's zone (a time skipped by the March clock change lands an hour
    -- later, and is kept once), and the end of its interval.
    select distinct (t at time zone v_zone) as slot_start, ((o.day + o.ends) at time zone v_zone) as open_until
      from open o
      cross join lateral generate_series(o.day + o.starts, o.day + o.ends - v_duration, v_step) t
     where not exists (select 1 from public.provider_time_off x
                        where x.provider_id = v_listing.provider_id and o.day between x.starts_on and x.ends_on)
  )
  select c.slot_start, c.slot_start + v_duration
    from candidates c
   where c.slot_start + v_duration <= c.open_until
     and c.slot_start >= p_now + v_notice
     and not exists (select 1 from public.provider_holds ph
                      where ph.provider_id = v_listing.provider_id
                        and ph.during && tstzrange(c.slot_start, c.slot_start + v_duration + v_buffer))
   order by 1;
end;
$$;

comment on function public.service_slots_core(uuid, date, date, timestamptz, boolean) is
  'The slots of a Service with a mode and a duration, between two market dates (1 to 31 days), as of p_now: its provider''s hours (date hours, or else weekly hours; none on time off), every slot interval, where the duration fits, at least the minimum notice ahead (and at least 4 hours for a Service the provider approves) and within the booking window, and not overlapping any of the provider''s holds (with the Service''s buffer). With p_require_bookable, only a live Service whose provider, category and city are active and whose provider can be paid. Called only by service_slots_at and my_service_slots_preview.';

-- Only the functions below call it (as its owner).
revoke execute on function public.service_slots_core(uuid, date, date, timestamptz, boolean) from anon, authenticated, service_role;

create or replace function public.service_slots_at(p_listing_id uuid, p_from date, p_to date, p_now timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.service_slots_core(p_listing_id, p_from, p_to, p_now, true);
$$;

comment on function public.service_slots_at(uuid, date, date, timestamptz) is
  'The times customers can book a Service from, as of a given time (p_now), so the clock-change days can be tested: service_slots_core for a bookable Service. Server only.';

create function public.my_service_slots_preview(p_listing_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.listings
                  where id = p_listing_id and provider_id = (select public.current_provider_id())) then
    raise exception 'That isn''t one of your listings.' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.service_slots_core(p_listing_id, p_from, p_to, now(), false);
end;
$$;

comment on function public.my_service_slots_preview(uuid, date, date) is
  'The signed-in provider''s preview of the times customers will see for one of their own Services, even while it''s a draft or before payouts are set up (it still needs a mode and a duration). Refuses another provider''s listing. For signed-in users.';

grant execute on function public.my_service_slots_preview(uuid, date, date) to authenticated;
revoke execute on function public.my_service_slots_preview(uuid, date, date) from service_role;
