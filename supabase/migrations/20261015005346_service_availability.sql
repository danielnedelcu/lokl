-- Service availability and slots, phase 1: the data (docs/design/service-availability.md,
-- approved 2026-10-14).
--
-- Providers publish when they work: weekly hours, hours for specific dates,
-- time off, and booking settings. Customers will book a slot worked out from
-- that availability (service_slots), and a booking holds its time: every
-- Service booking made from a slot and every scheduled Experience session
-- holds a range of its provider's time, and an exclusion constraint refuses
-- any overlap across all the provider's listings. Buffers come after a
-- booking only: [start, end + buffer).
--
-- The old request flow (create_service_request, preferred_times) stays
-- untouched until phase 3 moves the website to slots; phase 3's migration
-- removes it and expires any request still open. A Service booked the old
-- way gets no hold when accepted (only those already confirmed are held,
-- below), which is fine for test data and ends with phase 3.
--
-- Deferred: "a Service has a mode" as a constraint (phase 2, with the
-- editor and the test fixtures), the editor and pages (phases 2 and 3),
-- search by availability (phase 4).

-- ---------------------------------------------------------------------------
-- EXTENSION
-- ---------------------------------------------------------------------------

-- btree_gist lets one exclusion constraint compare a provider id (=) and a
-- time range (&&). Its functions are used only inside indexes, which need
-- no privileges; no API role calls them. On Supabase an extension's
-- functions are installed by supabase_admin with EXECUTE for PUBLIC, which
-- our migrations (as postgres) can't revoke. So btree_gist lives in a schema
-- of its own that no API role can use: calling any of its functions needs
-- USAGE on the schema, and nobody but the owner has it (pgTAP checks both).
create schema if not exists gist_support;
comment on schema gist_support is
  'btree_gist, for exclusion constraints (provider_holds, provider_weekly_hours, provider_date_hours). No API role may use it.';
revoke all on schema gist_support from public, anon, authenticated, service_role;
create extension if not exists btree_gist with schema gist_support;

-- ---------------------------------------------------------------------------
-- PROVIDER SCHEDULES
-- ---------------------------------------------------------------------------

create table public.provider_schedules (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  booking_window_days smallint not null default 60 check (booking_window_days between 7 and 180),
  min_notice_minutes integer not null default 1440 check (min_notice_minutes between 60 and 10080),
  slot_interval_minutes smallint not null default 30 check (slot_interval_minutes in (15, 30, 60)),
  default_buffer_minutes smallint not null default 0 check (default_buffer_minutes between 0 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.provider_schedules is
  'A provider''s booking settings, one row per provider (defaults apply without one). The provider writes it; deleting it goes back to the defaults. Goes with its provider (providers are never deleted).';
comment on column public.provider_schedules.booking_window_days is 'How far ahead customers can book, in days (7 to 180).';
comment on column public.provider_schedules.min_notice_minutes is 'The least notice a booking needs, in minutes (one hour to one week).';
comment on column public.provider_schedules.slot_interval_minutes is 'How often a slot can start: every 15, 30 or 60 minutes.';
comment on column public.provider_schedules.default_buffer_minutes is 'Free time after each booking (for travel), for Services without their own and for Experience sessions.';

create trigger provider_schedules_set_updated_at
  before update on public.provider_schedules
  for each row execute function public.set_updated_at();

create table public.provider_weekly_hours (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts time not null,
  ends time not null,
  created_at timestamptz not null default now(),
  check (ends > starts),
  -- Intervals on one weekday don't overlap (they may touch).
  exclude using gist (provider_id with =, weekday with =,
    tsrange(date '2000-01-02' + starts, date '2000-01-02' + ends) with &&)
);

comment on table public.provider_weekly_hours is
  'A provider''s repeating weekly hours: one row per interval (a day can have several). Wall-clock times in the market''s time zone. The provider adds, changes and deletes them freely; nothing points here.';
comment on column public.provider_weekly_hours.weekday is '0 is Sunday, 6 is Saturday.';
comment on column public.provider_weekly_hours.ends is 'The end of the interval, after starts; 24:00 is the end of the day.';

create table public.provider_date_hours (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  on_date date not null,
  starts time not null,
  ends time not null,
  created_at timestamptz not null default now(),
  check (ends > starts),
  exclude using gist (provider_id with =, tsrange(on_date + starts, on_date + ends) with &&)
);

comment on table public.provider_date_hours is
  'Hours for one date, replacing that weekday''s weekly hours: one row per interval. A day off is time off for that date. The provider adds, changes and deletes them freely; nothing points here.';

create table public.provider_time_off (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

comment on table public.provider_time_off is
  'Whole days a provider isn''t available, from starts_on to ends_on (inclusive), whatever their hours. The provider adds, changes and deletes them freely; nothing points here.';
comment on column public.provider_time_off.note is 'For the provider alone (customers never see it).';

create index provider_weekly_hours_provider_idx on public.provider_weekly_hours (provider_id, weekday);
create index provider_date_hours_provider_idx on public.provider_date_hours (provider_id, on_date);
create index provider_time_off_provider_idx on public.provider_time_off (provider_id, starts_on);

-- Row rules: a provider reads and writes their own; admins read all;
-- visitors read none (they see slots, through service_slots).
do $$
declare
  t text;
begin
  foreach t in array array['provider_schedules', 'provider_weekly_hours', 'provider_date_hours', 'provider_time_off'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (provider_id = (select public.current_provider_id()))', t || '_read_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()))', t || '_read_admin', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (provider_id = (select public.current_provider_id()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (provider_id = (select public.current_provider_id())) with check (provider_id = (select public.current_provider_id()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (provider_id = (select public.current_provider_id()))', t || '_delete_own', t);
    execute format('comment on policy %I on public.%I is %L', t || '_read_own', t, 'Providers read their own.');
    execute format('comment on policy %I on public.%I is %L', t || '_read_admin', t, 'Admins read all.');
    execute format('comment on policy %I on public.%I is %L', t || '_insert_own', t, 'Providers add their own.');
    execute format('comment on policy %I on public.%I is %L', t || '_update_own', t, 'Providers change their own, and can''t give them to another provider.');
    execute format('comment on policy %I on public.%I is %L', t || '_delete_own', t, 'Providers delete their own.');
  end loop;
end;
$$;

-- Column grants: signed-in users (under the row rules above); visitors nothing.
grant select, delete on public.provider_schedules, public.provider_weekly_hours, public.provider_date_hours, public.provider_time_off to authenticated;
grant insert (provider_id, booking_window_days, min_notice_minutes, slot_interval_minutes, default_buffer_minutes),
      update (booking_window_days, min_notice_minutes, slot_interval_minutes, default_buffer_minutes)
  on public.provider_schedules to authenticated;
grant insert (provider_id, weekday, starts, ends), update (weekday, starts, ends) on public.provider_weekly_hours to authenticated;
grant insert (provider_id, on_date, starts, ends), update (on_date, starts, ends) on public.provider_date_hours to authenticated;
grant insert (provider_id, starts_on, ends_on, note), update (starts_on, ends_on, note) on public.provider_time_off to authenticated;

-- ---------------------------------------------------------------------------
-- LISTINGS AND BOOKINGS: MODES AND BUFFERS
-- ---------------------------------------------------------------------------

alter table public.listings
  add column booking_mode text check (booking_mode in ('instant', 'approve')),
  add column buffer_minutes smallint check (buffer_minutes between 0 and 120),
  add constraint listings_service_settings check (kind = 'service' or (booking_mode is null and buffer_minutes is null));

comment on column public.listings.booking_mode is
  'Services: instant (booked and paid from a slot) or approve (a slot requested, the card held, the provider accepts or declines). Chosen by the provider; a Service without one isn''t bookable. Null on Experiences.';
comment on column public.listings.buffer_minutes is
  'Services: free time after each booking (for travel), 0 to 120 minutes; null uses the provider''s default.';

grant insert (booking_mode, buffer_minutes), update (booking_mode, buffer_minutes) on public.listings to authenticated;

alter table public.bookings
  add column service_mode text check (service_mode in ('instant', 'approve')),
  drop constraint bookings_service_shape,
  -- A Service is booked from a slot (its mode, start and end set when it's
  -- made), or, until phase 3 removes it, requested with offered times.
  add constraint bookings_service_shape check (
    kind <> 'service' or (session_id is null and party_size = 1 and (
      (service_mode is not null and preferred_times is null and starts_at is not null and ends_at is not null)
      or (service_mode is null and cardinality(preferred_times) between 1 and 3)))
  ),
  add constraint bookings_service_mode_only_services check (kind = 'service' or service_mode is null);

comment on column public.bookings.service_mode is
  'Services booked from a slot: the listing''s booking mode when it was made (instant or approve). Null for Experiences and old requests. Written only by create_service_booking.';

-- ---------------------------------------------------------------------------
-- HOLDS: NO DOUBLE BOOKING
-- ---------------------------------------------------------------------------

create table public.provider_holds (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  during tstzrange not null check (not isempty(during)),
  -- Deleted with what they hold. Bookings are never deleted in use (only by
  -- local test clean-up); sessions are, before they have bookings.
  booking_id uuid unique references public.bookings (id) on delete cascade,
  session_id uuid unique references public.experience_sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((booking_id is null) <> (session_id is null)),
  constraint provider_holds_no_overlap exclude using gist (provider_id with =, during with &&)
);

comment on table public.provider_holds is
  'The provider''s time each Service booking (from a slot) and each scheduled Experience session takes: [start, end + buffer). No two of a provider''s holds overlap, across all their listings. Written only by triggers on bookings and experience_sessions; deleted when the booking is released (expired, declined, cancelled) or the session cancelled or deleted. Not readable through the API.';
comment on column public.provider_holds.during is
  'The time held: from the start to the end plus the buffer, as it was when the booking or session was made.';

alter table public.provider_holds enable row level security;
-- Admins read them (the admin app's booking and provider pages); providers
-- and visitors don't: a provider sees their own bookings and sessions, and
-- customers only the slots.
create policy provider_holds_read_admin
  on public.provider_holds for select to authenticated
  using ((select public.is_admin()));
comment on policy provider_holds_read_admin on public.provider_holds is 'Admins read all holds.';
grant select on public.provider_holds to authenticated;
create index provider_holds_provider_idx on public.provider_holds using gist (provider_id, during);

-- The provider and buffer for a listing's holds.
create function public.hold_buffer(p_listing public.listings)
returns interval
language sql
stable
set search_path = ''
as $$
  select make_interval(mins => coalesce(p_listing.buffer_minutes,
    (select s.default_buffer_minutes from public.provider_schedules s where s.provider_id = p_listing.provider_id), 0));
$$;
comment on function public.hold_buffer(public.listings) is
  'The free time after a booking or session of this listing: the Service''s own buffer, or the provider''s default, or none.';
-- Called only inside the security-definer functions below (as their owner).
revoke execute on function public.hold_buffer(public.listings) from anon, authenticated, service_role;

create function public.bookings_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  -- Released: whatever made the hold (a slot booking, or one held when this
  -- migration ran).
  if tg_op = 'UPDATE' then
    if new.status in ('expired', 'declined', 'cancelled') then
      delete from public.provider_holds where booking_id = new.id;
    end if;
    return new;
  end if;
  -- Made: a Service booked from a slot.
  if new.kind = 'service' and new.service_mode is not null then
    select * into v_listing from public.listings where id = new.listing_id;
    begin
      insert into public.provider_holds (provider_id, booking_id, during)
      values (new.provider_id, new.id, tstzrange(new.starts_at, new.ends_at + public.hold_buffer(v_listing)));
    exception when exclusion_violation then
      raise exception 'That time was just taken. Pick another.' using errcode = 'exclusion_violation';
    end;
  end if;
  return new;
end;
$$;
comment on function public.bookings_hold() is
  'Trigger function: a Service booking made from a slot holds [start, end + buffer) of its provider''s time, refused if that overlaps another hold; released when it expires, is declined or cancelled.';

create trigger bookings_hold
  after insert or update of status on public.bookings
  for each row execute function public.bookings_hold();

create function public.experience_sessions_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  if new.status = 'cancelled' then
    delete from public.provider_holds where session_id = new.id;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.starts_at = old.starts_at and new.status = old.status then
    return new;
  end if;
  select * into v_listing from public.listings where id = new.listing_id;
  begin
    insert into public.provider_holds (provider_id, session_id, during)
    values (v_listing.provider_id, new.id,
      tstzrange(new.starts_at, new.starts_at + make_interval(mins => coalesce(v_listing.duration_minutes, 0)) + public.hold_buffer(v_listing)))
    on conflict (session_id) do update set during = excluded.during;
  exception when exclusion_violation then
    raise exception 'That time overlaps another of your bookings or sessions.' using errcode = 'exclusion_violation';
  end;
  return new;
end;
$$;
comment on function public.experience_sessions_hold() is
  'Trigger function: a scheduled Experience session holds [start, start + duration + buffer) of its provider''s time, refused if that overlaps another hold; moved with the session, released when it''s cancelled (or deleted, by cascade).';

create trigger experience_sessions_hold
  after insert or update of starts_at, status on public.experience_sessions
  for each row execute function public.experience_sessions_hold();

-- Trigger functions reach no API role (their triggers fire regardless).
revoke execute on function public.bookings_hold() from anon, authenticated, service_role;
revoke execute on function public.experience_sessions_hold() from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SLOTS
-- ---------------------------------------------------------------------------

create function public.service_slots_at(p_listing_id uuid, p_from date, p_to date, p_now timestamptz)
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
  -- Only a live, bookable Service whose provider can be paid has slots;
  -- anything else has none (and says nothing about why).
  if v_listing.id is null or v_listing.kind <> 'service' or v_listing.status <> 'live'
     or v_listing.booking_mode is null or v_listing.duration_minutes is null
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id)
     or not exists (select 1 from public.providers p where p.id = v_listing.provider_id
                     and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) = 'ready') then
    return;
  end if;
  select c.timezone into v_zone from public.cities c where c.id = v_listing.city_id;
  select coalesce(s.booking_window_days, 60), make_interval(mins => coalesce(s.min_notice_minutes, 1440)),
         make_interval(mins => coalesce(s.slot_interval_minutes, 30))
    into v_window, v_notice, v_step
    from (select 1) one left join public.provider_schedules s on s.provider_id = v_listing.provider_id;
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

comment on function public.service_slots_at(uuid, date, date, timestamptz) is
  'service_slots as of a given time (p_now), so the clock-change days can be tested: the times a live Service whose provider can be paid can be booked from, between two market dates (1 to 31 days): its provider''s hours for each day (date hours, or else weekly hours; none on time off), every slot interval, where the duration fits, at least the minimum notice ahead and within the booking window, and not overlapping any of the provider''s holds (with the Service''s buffer). Server only.';

-- Server only (and service_slots, which runs as the owner).
revoke execute on function public.service_slots_at(uuid, date, date, timestamptz) from anon, authenticated;

create function public.service_slots(p_listing_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.service_slots_at(p_listing_id, p_from, p_to, now());
$$;

comment on function public.service_slots(uuid, date, date) is
  'The times a live Service can be booked from now, between two market dates (1 to 31 days): service_slots_at as of now. Nothing for a listing that isn''t a bookable Service, or whose provider can''t be paid yet. For visitors, signed-in users and the server.';

grant execute on function public.service_slots(uuid, date, date) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- BOOKING A SLOT
-- ---------------------------------------------------------------------------

create function public.create_service_booking(
  p_listing_id uuid, p_customer_id uuid, p_starts_at timestamptz, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_notes text, p_address jsonb, p_reserved_until timestamptz,
  p_checkout_key uuid default null, p_request_hash text default null
)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_zone text;
  v_money record;
  v_booking public.bookings;
begin
  -- The same attempt again: the booking it already made.
  if p_checkout_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_id::text || '/' || p_checkout_key::text, 0));
    select * into v_booking from public.bookings where customer_id = p_customer_id and checkout_key = p_checkout_key;
    if v_booking.id is not null then
      if v_booking.checkout_request_hash is distinct from p_request_hash then
        raise exception 'This checkout was started with different details. Check your details and try again.' using errcode = 'check_violation';
      end if;
      return v_booking;
    end if;
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if v_listing.id is null or v_listing.kind <> 'service' or v_listing.status <> 'live' or v_listing.booking_mode is null
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id) then
    raise exception 'This Service isn''t available to book.' using errcode = 'check_violation';
  end if;
  if v_listing.booking_mode = 'approve' and p_starts_at < now() + interval '4 hours' then
    raise exception 'This Service needs at least 4 hours'' notice, so the provider has time to answer.' using errcode = 'check_violation';
  end if;
  select c.timezone into v_zone from public.cities c where c.id = v_listing.city_id;
  if not exists (select 1 from public.service_slots(v_listing.id, (p_starts_at at time zone v_zone)::date, (p_starts_at at time zone v_zone)::date) s
                  where s.starts_at = p_starts_at) then
    raise exception 'That time isn''t available. Pick another.' using errcode = 'check_violation';
  end if;
  if (v_listing.location_mode = 'customer_location') <> (p_address is not null) then
    raise exception using errcode = 'check_violation', message = case
      when p_address is null then 'Add the address where the Service should happen.'
      else 'This Service happens at the provider''s place, so no address is needed.' end;
  end if;

  select * into v_money from public.booking_money('service', v_listing.price_cents, 1::smallint);
  -- The hold is made by the bookings_hold trigger; two customers choosing the
  -- same slot at once: the second is refused there.
  insert into public.bookings (kind, listing_id, provider_id, customer_id, service_mode, starts_at, ends_at, customer_name,
    customer_notes, unit_price_cents, total_cents, reserved_until, status_changed_by, customer_city, customer_postal_code,
    checkout_key, checkout_request_hash)
  values ('service', v_listing.id, v_listing.provider_id, p_customer_id, v_listing.booking_mode, p_starts_at,
    p_starts_at + make_interval(mins => v_listing.duration_minutes), p_customer_name,
    nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total, p_reserved_until, 'customer',
    p_address ->> 'city', p_address ->> 'postal_code', p_checkout_key, p_request_hash)
  returning * into v_booking;
  insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents)
  values (v_booking.id, v_money.rate, v_money.commission, v_money.provider_amount);
  insert into public.booking_contacts (booking_id, email, phone) values (v_booking.id, p_customer_email, nullif(p_customer_phone, ''));
  if p_address is not null then
    insert into public.booking_addresses (booking_id, line1, line2, city, state, postal_code, instructions)
    values (v_booking.id, p_address ->> 'line1', nullif(p_address ->> 'line2', ''), p_address ->> 'city',
            p_address ->> 'state', p_address ->> 'postal_code', nullif(p_address ->> 'instructions', ''));
  end if;
  return v_booking;
end;
$$;

comment on function public.create_service_booking(uuid, uuid, timestamptz, text, text, text, text, jsonb, timestamptz, uuid, text) is
  'Server only: books a slot of a live Service (pending payment), in the listing''s mode (instant or approve), with the customer''s contact details and, for "I come to you", their address; price and commission worked out here. Refuses a time that isn''t one of service_slots, an approval booking less than 4 hours ahead, and a time taken meanwhile. With a checkout key: returns the booking already made with that key (refusing other details).';

grant execute on function public.create_service_booking(uuid, uuid, timestamptz, text, text, text, text, jsonb, timestamptz, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- THE BOOKING GUARD
-- ---------------------------------------------------------------------------

create or replace function public.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing record;
  v_duration interval;
  v_fin public.booking_finances;
  v_note text;
  v_accepted_at timestamptz;
begin
  select l.kind, l.provider_id, l.duration_minutes, p.owner_id
    into v_listing
    from public.listings l join public.providers p on p.id = l.provider_id
   where l.id = new.listing_id;

  if tg_op = 'INSERT' then
    if v_listing.kind is distinct from new.kind or v_listing.provider_id is distinct from new.provider_id then
      raise exception 'The booking doesn''t match its listing.' using errcode = 'check_violation';
    end if;
    if v_listing.owner_id = new.customer_id then
      raise exception 'You can''t book your own listing.' using errcode = 'check_violation';
    end if;
    if new.session_id is not null and not exists (
      select 1 from public.experience_sessions where id = new.session_id and listing_id = new.listing_id) then
      raise exception 'That session belongs to another listing.' using errcode = 'check_violation';
    end if;
    if new.status <> 'pending_payment' then
      raise exception 'A new booking starts as pending_payment.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: what a booking is, and its money, never change.
  if new.kind is distinct from old.kind or new.listing_id is distinct from old.listing_id
     or new.provider_id is distinct from old.provider_id or new.customer_id is distinct from old.customer_id
     or new.session_id is distinct from old.session_id or new.party_size is distinct from old.party_size
     or new.preferred_times is distinct from old.preferred_times
     or new.service_mode is distinct from old.service_mode
     or new.unit_price_cents is distinct from old.unit_price_cents or new.total_cents is distinct from old.total_cents
     or new.customer_city is distinct from old.customer_city
     or new.customer_postal_code is distinct from old.customer_postal_code then
    raise exception 'A booking''s listing, customer, size, times offered and price can''t be changed.'
      using errcode = 'check_violation';
  end if;
  -- A Service booked from a slot (service_mode set) keeps its time: it was
  -- chosen, checked and held when the booking was made.
  if old.service_mode is not null
     and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    raise exception 'A booked time can''t be changed.' using errcode = 'check_violation';
  end if;
  -- The money side lives in booking_finances (written first, in the same
  -- statement, through private.booking_records); read it for the checks below.
  select * into v_fin from public.booking_finances where booking_id = new.id;
  if new.refunded_cents < old.refunded_cents then
    raise exception 'A refund can''t be undone.' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending_payment' and new.status in ('requested', 'confirmed', 'expired', 'cancelled'))
      or (old.status = 'requested' and new.status in ('confirmed', 'declined', 'expired', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('completed', 'cancelled'))
      or (old.status = 'completed' and new.status in ('paid_out', 'cancelled'))
      -- lokl cancels after the payout: refunded, and the transfer reversed
      -- (or the reversal's failure recorded as money owed).
      or (old.status = 'paid_out' and new.status = 'cancelled')
      -- A customer who cancels within 48 hours gets no refund, and the
      -- provider is still paid their share at payout.
      or (old.status = 'cancelled' and new.status = 'paid_out'
          and old.cancelled_by = 'customer' and old.refunded_cents = 0 and old.confirmed_at is not null)
    ) then
      raise exception 'A booking can''t go from % to %.', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'requested' and new.kind <> 'service' then
      raise exception 'Only Service bookings are requested.' using errcode = 'check_violation';
    end if;
    if new.status = 'confirmed' and old.status = 'pending_payment' and new.kind <> 'experience'
       and new.service_mode is distinct from 'instant' then
      raise exception 'A Service is confirmed by the provider accepting a request.' using errcode = 'check_violation';
    end if;
    if new.status = 'requested' and new.service_mode = 'instant' then
      raise exception 'An instant booking is confirmed when it''s paid, not requested.' using errcode = 'check_violation';
    end if;
    -- An approval booking is answered at least 2 hours before it starts
    -- (and within 48 hours of the payment, which the server sets).
    if new.status = 'requested' and new.service_mode = 'approve' then
      new.respond_by := least(coalesce(new.respond_by, new.starts_at - interval '2 hours'), new.starts_at - interval '2 hours');
    end if;
    -- A reported problem holds the payout until lokl resolves it in the
    -- provider's favour.
    if new.status = 'paid_out' and new.problem_reported_at is not null
       and new.problem_resolution is distinct from 'paid_provider' then
      raise exception 'A reported problem holds the payout.' using errcode = 'check_violation';
    end if;
    -- Paid out means a transfer was made, nothing holds it, and no dispute
    -- is open.
    if new.status = 'paid_out' then
      if v_fin.stripe_transfer_id is null then
        raise exception 'A booking is paid out only with its transfer recorded.' using errcode = 'check_violation';
      end if;
      if v_fin.payout_hold is not null then
        raise exception 'This payout is on hold for lokl to review.' using errcode = 'check_violation';
      end if;
      if v_fin.disputed_at is not null and v_fin.dispute_closed_at is null then
        raise exception 'An open dispute holds the payout.' using errcode = 'check_violation';
      end if;
    end if;
    -- Accepting a request: before the answer-by time, and for a time that
    -- hasn't passed. When the provider accepted is now, or, when a lost
    -- reply is finished later (a retry, Stripe's webhook, the expiry job),
    -- the time Stripe captured the card, which the server passes as
    -- confirmed_at: between the request and now.
    if old.status = 'requested' and new.status = 'confirmed' then
      v_accepted_at := case when new.confirmed_at is distinct from old.confirmed_at then new.confirmed_at end;
      if v_accepted_at is not null and (v_accepted_at > now() or v_accepted_at < old.created_at) then
        raise exception 'A request is accepted between when it was made and now.' using errcode = 'check_violation';
      end if;
      if old.respond_by is not null and coalesce(v_accepted_at, now()) > old.respond_by then
        raise exception 'The time to answer this request has passed.' using errcode = 'check_violation';
      end if;
      if new.starts_at <= now() then
        raise exception 'That time has already passed.' using errcode = 'check_violation';
      end if;
    end if;
    if new.status = 'confirmed' then
      if new.kind = 'service' and new.service_mode is null and not (new.starts_at = any (new.preferred_times)) then
        raise exception 'Accept one of the times the customer offered.' using errcode = 'check_violation';
      end if;
      new.confirmed_at := coalesce(v_accepted_at, now());
      -- A slot booking's end was set (and held) when it was made.
      if new.service_mode is null then
        v_duration := make_interval(mins => coalesce(v_listing.duration_minutes, 0));
        new.ends_at := new.starts_at + v_duration;
      end if;
      new.payout_due_at := new.ends_at + interval '24 hours';
    end if;
    if new.status = 'cancelled' then
      -- When it was cancelled: now, or, when a lost reply is finished later,
      -- the time Stripe made the refund, which the server passes: between
      -- the booking and now. The policy below goes by this time.
      new.cancelled_at := least(coalesce(new.cancelled_at, now()), now());
      if new.cancelled_at < coalesce(old.confirmed_at, old.created_at) then
        raise exception 'A booking is cancelled between when it was booked and now.' using errcode = 'check_violation';
      end if;
      if new.cancelled_by is null then
        raise exception 'Say who cancelled the booking.' using errcode = 'check_violation';
      end if;
      -- The cancellation policy (decision 5, and the 1-hour grace period
      -- decided 2026-10-02), for bookings that were paid.
      if old.status in ('confirmed', 'completed', 'paid_out') then
        if old.status = 'completed' and new.cancelled_by not in ('admin', 'system') then
          raise exception 'This booking has already happened, so only lokl can cancel it.' using errcode = 'check_violation';
        end if;
        if old.status = 'paid_out' then
          if new.cancelled_by <> 'admin' then
            raise exception 'Only lokl can cancel a booking that has been paid out.' using errcode = 'check_violation';
          end if;
          if v_fin.stripe_transfer_reversal_id is null and v_fin.reversal_failed_at is null then
            raise exception 'Reverse the provider''s transfer (or record why it failed) before cancelling a paid-out booking.'
              using errcode = 'check_violation';
          end if;
        end if;
        if new.cancelled_by in ('customer', 'provider') and new.cancelled_at >= old.starts_at then
          raise exception 'This booking has started, so it can''t be cancelled.' using errcode = 'check_violation';
        end if;
        if new.cancelled_by = 'provider' and coalesce(char_length(trim(new.cancel_reason)), 0) < 5 then
          raise exception 'Say why you''re cancelling. The customer sees it.' using errcode = 'check_violation';
        end if;
        -- Full refund: the provider, lokl or the system cancelled; or the
        -- customer did 48 hours or more ahead, or within an hour of booking.
        if (new.cancelled_by <> 'customer'
            or new.cancelled_at <= old.starts_at - interval '48 hours'
            or new.cancelled_at <= old.confirmed_at + interval '1 hour')
           and new.refunded_cents < new.total_cents then
          raise exception 'This cancellation gets a full refund. Refund it before cancelling.' using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;

  -- "The provider didn't show up": once, with a note, between the start and
  -- the payout time, on a booking that happened and isn't paid out.
  -- (The note itself is in booking_reports, which never changes once written.)
  if old.problem_reported_at is not null and new.problem_reported_at is distinct from old.problem_reported_at then
    raise exception 'A problem has already been reported on this booking.' using errcode = 'check_violation';
  end if;
  if old.problem_reported_at is null and new.problem_reported_at is not null then
    if old.status not in ('confirmed', 'completed') or now() < old.starts_at or now() >= old.payout_due_at then
      raise exception 'A problem can be reported from the start of a booking until its payout.' using errcode = 'check_violation';
    end if;
    select note into v_note from public.booking_reports where booking_id = new.id;
    if coalesce(char_length(trim(v_note)), 0) < 10 then
      raise exception 'Say what happened, in a sentence or two.' using errcode = 'check_violation';
    end if;
  end if;

  -- Resolving a no-show report (lokl only): once, on a reported booking. A
  -- refund resolves it with the booking cancelled and refunded in full.
  if old.problem_resolution is not null
     and (new.problem_resolution is distinct from old.problem_resolution or new.problem_resolved_at is distinct from old.problem_resolved_at) then
    raise exception 'This report has already been resolved.' using errcode = 'check_violation';
  end if;
  if old.problem_resolution is null and new.problem_resolution is not null then
    if new.problem_reported_at is null then
      raise exception 'Only a reported problem can be resolved.' using errcode = 'check_violation';
    end if;
    if new.problem_resolution = 'refunded' and (new.status <> 'cancelled' or new.refunded_cents < new.total_cents) then
      raise exception 'Resolving a report with a refund cancels the booking and refunds it in full.' using errcode = 'check_violation';
    end if;
  end if;

  if new.status is distinct from old.status then
    null; -- (checked above)
  elsif new.starts_at is distinct from old.starts_at or new.payout_due_at is distinct from old.payout_due_at
        or new.confirmed_at is distinct from old.confirmed_at then
    raise exception 'A booking''s time and payout date only change with its status.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.bookings_guard() is
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size, mode and price, follows the allowed status changes (an instant Service is confirmed when paid and never requested; an approval Service is answered at least 2 hours before it starts), keeps a slot booking''s time, is accepted only before its answer-by time (judged at confirmed_at when the server passes the time Stripe captured the card) and for a time still ahead, gets its payout time (24 hours after the end) on confirmation (and, for old requests, its end), and is cancelled under the policy as of cancelled_at (now, or the time Stripe refunded).';

-- ---------------------------------------------------------------------------
-- THE TEST DATA (lokl isn't live; production is a fresh project)
-- ---------------------------------------------------------------------------

-- Every existing Service books by approval, the closest to the request flow.
update public.listings set booking_mode = 'approve' where kind = 'service';

-- Holds for what's already booked ahead: scheduled sessions and confirmed
-- Services. The hosted test data has no overlaps (counted 2026-10-14), so
-- they're all enforced; an overlap here stops the migration.
insert into public.provider_holds (provider_id, session_id, during)
select l.provider_id, s.id,
       tstzrange(s.starts_at, s.starts_at + make_interval(mins => coalesce(l.duration_minutes, 0)) + public.hold_buffer(l))
  from public.experience_sessions s join public.listings l on l.id = s.listing_id
 where s.status = 'scheduled' and s.starts_at > now();
insert into public.provider_holds (provider_id, booking_id, during)
select b.provider_id, b.id, tstzrange(b.starts_at, b.ends_at + public.hold_buffer(l))
  from public.bookings b join public.listings l on l.id = b.listing_id
 where b.kind = 'service' and b.status = 'confirmed' and b.starts_at > now() and b.ends_at > b.starts_at;
