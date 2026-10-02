-- Step 4, part 4: providers answer Service requests.
--
-- 1. A request shows the customer's city and zip code, so the provider can
--    judge the trip before accepting. They're copied onto the booking when
--    the request is made; the street address stays in booking_addresses,
--    which the provider reads only once they accept (decided 2026-10-02).
-- 2. Accepting must happen before the answer-by time, for a time that
--    hasn't passed. The server checks first; this is the enforcement.
-- 3. "enough spots left for 1 people" reads "1 person".
--
-- No new access rules: bookings are already readable by their provider, and
-- signed-in users still write nothing here. Delete behaviour is unchanged
-- (bookings are never deleted).

-- ---------------------------------------------------------------------------
-- 1. THE CUSTOMER'S AREA ON A REQUEST
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column customer_city text check (char_length(customer_city) between 2 and 80),
  add column customer_postal_code text check (customer_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  add constraint bookings_customer_area check (
    (customer_city is null) = (customer_postal_code is null)
    and (kind = 'service' or customer_city is null));
comment on column public.bookings.customer_city is
  '"I come to you" Services: the customer''s city, copied from their address when the request is made, so the provider sees roughly where before accepting. Never changes.';
comment on column public.bookings.customer_postal_code is
  '"I come to you" Services: the customer''s zip code, copied like customer_city. The street address stays in booking_addresses until the provider accepts.';

-- Requests made before this migration (test data only): copy from the
-- address. Runs before the guard below makes these columns fixed.
update public.bookings b
   set customer_city = a.city, customer_postal_code = a.postal_code
  from public.booking_addresses a
 where a.booking_id = b.id and b.customer_city is null;

-- create_service_request: as before, plus the city and zip code.
create or replace function public.create_service_request(
  p_listing_id uuid, p_customer_id uuid, p_preferred_times timestamptz[], p_customer_name text,
  p_customer_email text, p_customer_phone text, p_customer_notes text, p_address jsonb, p_reserved_until timestamptz)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_money record;
  v_booking public.bookings;
begin
  select * into v_listing from public.listings where id = p_listing_id;
  if v_listing.id is null or v_listing.kind <> 'service' or v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id) then
    raise exception 'This Service isn''t available to book.' using errcode = 'check_violation';
  end if;
  if cardinality(p_preferred_times) not between 1 and 3
     or (select count(distinct t) from unnest(p_preferred_times) t) <> cardinality(p_preferred_times) then
    raise exception 'Offer one to three different times.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(p_preferred_times) t where t < now() + interval '24 hours') then
    raise exception 'Each time needs to be at least 24 hours from now.' using errcode = 'check_violation';
  end if;
  if (v_listing.location_mode = 'customer_location') <> (p_address is not null) then
    raise exception using errcode = 'check_violation', message = case
      when p_address is null then 'Add the address where the Service should happen.'
      else 'This Service happens at the provider''s place, so no address is needed.' end;
  end if;

  select * into v_money from public.booking_money('service', v_listing.price_cents, 1::smallint);
  insert into public.bookings (kind, listing_id, provider_id, customer_id, preferred_times, customer_name,
    customer_notes, unit_price_cents, total_cents, commission_rate_bps, commission_cents, provider_amount_cents,
    reserved_until, status_changed_by, customer_city, customer_postal_code)
  values ('service', v_listing.id, v_listing.provider_id, p_customer_id, p_preferred_times, p_customer_name,
    nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total, v_money.rate, v_money.commission,
    v_money.provider_amount, p_reserved_until, 'customer', p_address ->> 'city', p_address ->> 'postal_code')
  returning * into v_booking;
  insert into public.booking_contacts (booking_id, email, phone) values (v_booking.id, p_customer_email, nullif(p_customer_phone, ''));
  if p_address is not null then
    insert into public.booking_addresses (booking_id, line1, line2, city, state, postal_code, instructions)
    values (v_booking.id, p_address ->> 'line1', nullif(p_address ->> 'line2', ''), p_address ->> 'city',
            p_address ->> 'state', p_address ->> 'postal_code', nullif(p_address ->> 'instructions', ''));
  end if;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. ANSWERING IN TIME (and the area never changes)
-- ---------------------------------------------------------------------------

-- bookings_guard: as before, plus the area in the fixed columns, and the
-- answer-by and time-passed checks when a request is accepted.
create or replace function public.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing record;
  v_duration interval;
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
     or new.unit_price_cents is distinct from old.unit_price_cents or new.total_cents is distinct from old.total_cents
     or new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.commission_cents is distinct from old.commission_cents
     or new.provider_amount_cents is distinct from old.provider_amount_cents
     or new.customer_city is distinct from old.customer_city
     or new.customer_postal_code is distinct from old.customer_postal_code then
    raise exception 'A booking''s listing, customer, size, times offered and price can''t be changed.'
      using errcode = 'check_violation';
  end if;
  if new.refunded_cents < old.refunded_cents then
    raise exception 'A refund can''t be undone.' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending_payment' and new.status in ('requested', 'confirmed', 'expired', 'cancelled'))
      or (old.status = 'requested' and new.status in ('confirmed', 'declined', 'expired', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('completed', 'cancelled'))
      or (old.status = 'completed' and new.status in ('paid_out', 'cancelled'))
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
    if new.status = 'confirmed' and old.status = 'pending_payment' and new.kind <> 'experience' then
      raise exception 'A Service is confirmed by the provider accepting a request.' using errcode = 'check_violation';
    end if;
    if new.status = 'paid_out' and new.problem_reported_at is not null then
      raise exception 'A reported problem holds the payout.' using errcode = 'check_violation';
    end if;
    -- Accepting a request: before the answer-by time, and for a time that
    -- hasn't passed.
    if old.status = 'requested' and new.status = 'confirmed' then
      if old.respond_by is not null and now() > old.respond_by then
        raise exception 'The time to answer this request has passed.' using errcode = 'check_violation';
      end if;
      if new.starts_at <= now() then
        raise exception 'That time has already passed.' using errcode = 'check_violation';
      end if;
    end if;
    if new.status = 'confirmed' then
      if new.kind = 'service' and not (new.starts_at = any (new.preferred_times)) then
        raise exception 'Accept one of the times the customer offered.' using errcode = 'check_violation';
      end if;
      v_duration := make_interval(mins => coalesce(v_listing.duration_minutes, 0));
      new.confirmed_at := now();
      new.ends_at := new.starts_at + v_duration;
      new.payout_due_at := new.ends_at + interval '24 hours';
    end if;
    if new.status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
      if new.cancelled_by is null then
        raise exception 'Say who cancelled the booking.' using errcode = 'check_violation';
      end if;
    end if;
  elsif new.starts_at is distinct from old.starts_at or new.payout_due_at is distinct from old.payout_due_at
        or new.confirmed_at is distinct from old.confirmed_at then
    raise exception 'A booking''s time and payout date only change with its status.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
comment on function public.bookings_guard() is
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, area, size and price, follows the allowed status changes, is accepted only before its answer-by time and for a time still ahead, and on confirmation gets its end and payout time (24 hours after the end).';

-- ---------------------------------------------------------------------------
-- 3. "1 PERSON"
-- ---------------------------------------------------------------------------

-- reserve_experience_booking: as before, with the message fixed.
create or replace function public.reserve_experience_booking(
  p_session_id uuid, p_customer_id uuid, p_party_size smallint, p_customer_name text,
  p_customer_email text, p_customer_phone text, p_customer_notes text, p_reserved_until timestamptz)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_session record;
  v_listing public.listings;
  v_money record;
  v_booking public.bookings;
begin
  select * into v_session from public.experience_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    raise exception 'That date isn''t available any more.' using errcode = 'check_violation';
  end if;
  select * into v_listing from public.listings where id = v_session.listing_id;
  if v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id) then
    raise exception 'This Experience isn''t available to book.' using errcode = 'check_violation';
  end if;
  if public.session_spots_taken(p_session_id) + p_party_size > v_session.capacity then
    raise exception 'There aren''t enough spots left for %.',
      case when p_party_size = 1 then '1 person' else p_party_size || ' people' end
      using errcode = 'check_violation';
  end if;

  select * into v_money from public.booking_money('experience', v_listing.price_cents, p_party_size);
  insert into public.bookings (kind, listing_id, provider_id, customer_id, session_id, starts_at, party_size,
    customer_name, customer_notes, unit_price_cents, total_cents, commission_rate_bps, commission_cents,
    provider_amount_cents, reserved_until, status_changed_by)
  values ('experience', v_listing.id, v_listing.provider_id, p_customer_id, p_session_id, v_session.starts_at,
    p_party_size, p_customer_name, nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total, v_money.rate,
    v_money.commission, v_money.provider_amount, p_reserved_until, 'customer')
  returning * into v_booking;
  insert into public.booking_contacts (booking_id, email, phone) values (v_booking.id, p_customer_email, nullif(p_customer_phone, ''));
  return v_booking;
end;
$$;
