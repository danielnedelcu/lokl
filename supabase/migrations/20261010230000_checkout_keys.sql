-- One booking per checkout attempt (decided 2026-10-10; docs/TODO.md,
-- Hardening: "A lost-response journey").
--
-- When the reply to "Continue to payment" was lost after the server had
-- made the booking, pressing again made a second booking and a second
-- Stripe Checkout, and for an Experience held the spots twice, so the
-- customer could be refused by their own lost attempt ("There aren't enough
-- spots left").
--
-- The booking page now sends a key per attempt (a new one whenever the
-- details change). The booking functions:
--   - return the booking already made with that key and the same details,
--     never a second one (the server then sends the customer to its
--     Checkout, its confirmation page, or says the checkout has ended);
--   - refuse the same key with other details, plainly;
--   - for an Experience, end the customer's earlier unpaid attempts for the
--     same session before counting spots, so a lost attempt can't block a
--     new one. (The server expires their Stripe Checkouts first; a payment
--     that still arrives for an ended attempt is refunded by the payments
--     webhook, as for any lapsed booking.)
-- Two simultaneous requests with one key run one after the other (an
-- advisory lock on the customer and key), and a unique index backs it up.
-- Calls without a key behave exactly as before.

-- ---------------------------------------------------------------------------
-- COLUMNS
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column checkout_key uuid,
  add column checkout_request_hash text check (checkout_request_hash ~ '^[0-9a-f]{64}$');

comment on column public.bookings.checkout_key is
  'The booking page''s key for the checkout attempt that made this booking: a retry with the same key returns this booking instead of a second one. Unique per customer. Written only by the booking functions (the server).';
comment on column public.bookings.checkout_request_hash is
  'SHA-256 of the attempt''s details (the validated request), so the same key with other details is refused. Written only by the booking functions.';

create unique index bookings_checkout_key_idx on public.bookings (customer_id, checkout_key) where checkout_key is not null;

-- Signed-in users already read bookings at the table level, under the row
-- rules (their own, or their business's); the key and fingerprint add
-- nothing private. They write nothing on bookings.

-- ---------------------------------------------------------------------------
-- THE BOOKING FUNCTIONS (new optional parameters, so dropped and recreated)
-- ---------------------------------------------------------------------------

drop function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz);
drop function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz);

create function public.reserve_experience_booking(
  p_session_id uuid, p_customer_id uuid, p_party_size smallint, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_notes text, p_reserved_until timestamptz,
  p_checkout_key uuid default null, p_request_hash text default null
)
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

  select * into v_session from public.experience_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    raise exception 'That date isn''t available any more.' using errcode = 'check_violation';
  end if;
  select * into v_listing from public.listings where id = v_session.listing_id;
  if v_listing.status <> 'live'
     or not public.listing_parents_active(v_listing.provider_id, v_listing.category_id, v_listing.city_id) then
    raise exception 'This Experience isn''t available to book.' using errcode = 'check_violation';
  end if;

  -- A new attempt ends the customer's earlier unpaid ones for this session,
  -- so their spots can't block it (a lost reply, then other details).
  if p_checkout_key is not null then
    update public.bookings
       set status = 'expired', status_changed_by = 'system'
     where customer_id = p_customer_id and session_id = p_session_id and status = 'pending_payment'
       and checkout_key is distinct from p_checkout_key;
  end if;

  if public.session_spots_taken(p_session_id) + p_party_size > v_session.capacity then
    raise exception 'There aren''t enough spots left for %.',
      case when p_party_size = 1 then '1 person' else p_party_size || ' people' end
      using errcode = 'check_violation';
  end if;

  select * into v_money from public.booking_money('experience', v_listing.price_cents, p_party_size);
  insert into public.bookings (kind, listing_id, provider_id, customer_id, session_id, starts_at, party_size,
    customer_name, customer_notes, unit_price_cents, total_cents, reserved_until, status_changed_by,
    checkout_key, checkout_request_hash)
  values ('experience', v_listing.id, v_listing.provider_id, p_customer_id, p_session_id, v_session.starts_at,
    p_party_size, p_customer_name, nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total,
    p_reserved_until, 'customer', p_checkout_key, p_request_hash)
  returning * into v_booking;
  insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents)
  values (v_booking.id, v_money.rate, v_money.commission, v_money.provider_amount);
  insert into public.booking_contacts (booking_id, email, phone) values (v_booking.id, p_customer_email, nullif(p_customer_phone, ''));
  return v_booking;
end;
$$;

create function public.create_service_request(
  p_listing_id uuid, p_customer_id uuid, p_preferred_times timestamptz[], p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_notes text, p_address jsonb, p_reserved_until timestamptz,
  p_checkout_key uuid default null, p_request_hash text default null
)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_money record;
  v_booking public.bookings;
begin
  -- The same attempt again: the request it already made.
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
    customer_notes, unit_price_cents, total_cents, reserved_until, status_changed_by, customer_city, customer_postal_code,
    checkout_key, checkout_request_hash)
  values ('service', v_listing.id, v_listing.provider_id, p_customer_id, p_preferred_times, p_customer_name,
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

comment on function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz, uuid, text) is
  'Server only: reserves spots in a session for a customer''s checkout, with the price and commission worked out here; refuses if the session isn''t bookable or the spots aren''t there. With a checkout key: returns the booking already made with that key (refusing other details), and ends the customer''s earlier unpaid attempts for the session first.';
comment on function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz, uuid, text) is
  'Server only: creates a Service request (pending payment) with up to three preferred times, the customer''s contact details and, for "I come to you", their address; price and commission worked out here. With a checkout key: returns the request already made with that key (refusing other details).';

-- Called by the server only (the booking routes), as before.
revoke execute on function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz, uuid, text) to service_role;
grant execute on function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz, uuid, text) to service_role;
