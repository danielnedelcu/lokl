-- Bookings (build step 4, part 1: database; docs/design/booking-and-checkout.md).
--
-- Every write to these tables comes from the website's server (the service
-- role), after its own checks and the Stripe calls. Signed-in users only read.
-- The money and status rules live here as well, so no route can get them
-- wrong: prices and commission are worked out from the listing and the rate
-- in force, status changes must follow the allowed paths, the payout date
-- follows from the booking's end, and the last spot of a session can't go
-- twice. Bookings, and everything hanging off them, are never deleted.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- COMMISSION RATES
-- ---------------------------------------------------------------------------

create table public.commission_rates (
  kind text primary key check (kind in ('service', 'experience')),
  rate_bps integer not null check (rate_bps between 0 and 5000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.commission_rates is
  'lokl''s commission per kind of listing, in basis points (1200 = 12%). Admin-editable. Each booking copies the rate in force when it''s created, so changes never touch past bookings. Never deleted.';
comment on column public.commission_rates.rate_bps is
  'Commission in basis points, 0 to 5000 (0% to 50%).';

insert into public.commission_rates (kind, rate_bps) values ('service', 1200), ('experience', 2000);

-- The admin's change is stamped with who and when, by the database.
create or replace function public.commission_rates_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
comment on function public.commission_rates_stamp() is
  'Trigger function: records when and by whom a commission rate was changed.';

create trigger commission_rates_stamp
  before update on public.commission_rates
  for each row execute function public.commission_rates_stamp();

alter table public.commission_rates enable row level security;

-- Signed-in users only: providers see the rate their bookings use. It isn't
-- shown to the public.
create policy commission_rates_read_signed_in
  on public.commission_rates for select to authenticated
  using (true);
comment on policy commission_rates_read_signed_in on public.commission_rates is
  'Signed-in users can read the commission rates.';

create policy commission_rates_update_admin
  on public.commission_rates for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
comment on policy commission_rates_update_admin on public.commission_rates is
  'Admins can change the commission rates.';

revoke all on public.commission_rates from anon;
revoke insert, update, delete on public.commission_rates from authenticated;
grant update (rate_bps) on public.commission_rates to authenticated;

-- ---------------------------------------------------------------------------
-- BOOKINGS
-- ---------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('service', 'experience')),
  listing_id uuid not null references public.listings (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  session_id uuid references public.experience_sessions (id) on delete restrict,
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'requested', 'confirmed', 'declined', 'expired', 'cancelled', 'completed', 'paid_out')),

  -- When: Services offer up to three times and the provider accepts one.
  preferred_times timestamptz[],
  starts_at timestamptz,
  ends_at timestamptz,

  -- Who, and how many.
  party_size smallint not null default 1 check (party_size between 1 and 10),
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_notes text check (char_length(customer_notes) <= 1000),

  -- Money, copied and worked out when the booking is created.
  unit_price_cents integer not null check (unit_price_cents > 0),
  total_cents integer not null,
  currency text not null default 'usd' check (currency = 'usd'),
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 5000),
  commission_cents integer not null check (commission_cents >= 0),
  provider_amount_cents integer not null check (provider_amount_cents >= 0),
  refunded_cents integer not null default 0,
  refunded_at timestamptz,

  -- Timing of the flow.
  reserved_until timestamptz,
  respond_by timestamptz,
  confirmed_at timestamptz,
  payout_due_at timestamptz,

  -- A transfer the provider's Stripe account couldn't receive: the payout is
  -- held and shown on the admin's "needs attention" list.
  payout_failed_at timestamptz,
  payout_failure text check (char_length(payout_failure) <= 500),

  -- Problems and cancellation.
  problem_reported_at timestamptz,
  problem_note text check (char_length(problem_note) <= 1000),
  cancelled_by text check (cancelled_by in ('customer', 'provider', 'admin', 'system')),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 1000),

  -- Who made the latest status change, for booking_events.
  status_changed_by text not null default 'system'
    check (status_changed_by in ('customer', 'provider', 'admin', 'system', 'stripe')),

  -- Stripe.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  stripe_transfer_id text unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bookings_total check (total_cents = unit_price_cents * party_size),
  constraint bookings_split check (commission_cents + provider_amount_cents = total_cents),
  constraint bookings_refund check (refunded_cents between 0 and total_cents),
  constraint bookings_service_shape check (
    kind <> 'service' or (session_id is null and party_size = 1
      and cardinality(preferred_times) between 1 and 3)
  ),
  constraint bookings_experience_shape check (
    kind <> 'experience' or (session_id is not null and preferred_times is null)
  ),
  constraint bookings_confirmed_has_time check (confirmed_at is null or (starts_at is not null and payout_due_at is not null))
);

create index bookings_customer_id_idx on public.bookings (customer_id, created_at desc);
create index bookings_provider_id_idx on public.bookings (provider_id, created_at desc);
create index bookings_session_id_idx on public.bookings (session_id) where session_id is not null;
create index bookings_listing_id_idx on public.bookings (listing_id);
create index bookings_due_idx on public.bookings (status, payout_due_at) where status in ('confirmed', 'completed', 'cancelled');
create index bookings_respond_by_idx on public.bookings (respond_by) where status = 'requested';
create index bookings_reserved_until_idx on public.bookings (reserved_until) where status = 'pending_payment';

comment on table public.bookings is
  'A customer''s booking of a Service (a request the provider accepts) or an Experience session (paid at once). Written only by the website''s server. lokl holds the payment and transfers the provider''s share 24 hours after the booking ends. Never deleted: payments, refunds and payouts point here.';
comment on column public.bookings.status is
  'pending_payment (in Stripe Checkout; spots held until reserved_until) -> requested (Service: card on hold, waiting for the provider) -> confirmed (accepted and charged, or Experience paid) -> completed (it happened) -> paid_out (provider''s share transferred). Or declined, expired, cancelled. A customer''s late cancellation (no refund) can still be paid out. The allowed changes are enforced by bookings_guard.';
comment on column public.bookings.preferred_times is
  'Services: one to three times the customer offers, each at least 24 hours ahead when requested. The provider accepts one, which becomes starts_at.';
comment on column public.bookings.starts_at is
  'Experiences: the session''s start, copied. Services: the accepted preferred time.';
comment on column public.bookings.ends_at is
  'starts_at plus the listing''s duration (or starts_at if it has none). Set by the database.';
comment on column public.bookings.party_size is
  'People booked: 1 for Services; 1 to 10 for Experiences, and no more than the spots left.';
comment on column public.bookings.customer_name is
  'The customer''s name from checkout. The provider sees it on the request.';
comment on column public.bookings.commission_rate_bps is
  'The commission rate in force when the booking was made (commission_rates), kept so later changes never affect it.';
comment on column public.bookings.provider_amount_cents is
  'What the provider receives: total minus commission. lokl pays Stripe''s fee from its commission.';
comment on column public.bookings.payout_due_at is
  'When the provider''s share may be transferred: 24 hours after ends_at. Set by the database on confirmation.';
comment on column public.bookings.problem_reported_at is
  'Set when the customer reports the provider didn''t show; holds the payout until the admin acts.';
comment on column public.bookings.payout_failed_at is
  'When the provider''s Stripe account couldn''t receive the transfer; the payout is held until it''s fixed, and the admin sees it under "needs attention".';
comment on column public.bookings.status_changed_by is
  'Who made the latest status change; copied into booking_events.';

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- BOOKINGS: integrity and status rules
-- ---------------------------------------------------------------------------

-- The rules hold for everyone, the server included: a bug in a route can't
-- book someone's own listing, skip a status, move money fields or misdate a
-- payout.
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
     or new.provider_amount_cents is distinct from old.provider_amount_cents then
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
  'Trigger function: a booking matches its listing, isn''t of the customer''s own listing, starts as pending_payment, keeps its listing, customer, size and price, follows the allowed status changes, and on confirmation gets its end and payout time (24 hours after the end).';

create trigger bookings_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_guard();

-- ---------------------------------------------------------------------------
-- BOOKING EVENTS (every status change)
-- ---------------------------------------------------------------------------

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  from_status text,
  to_status text not null,
  actor text not null,
  -- clock_timestamp, not now(): several changes in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp()
);
create index booking_events_booking_id_idx on public.booking_events (booking_id, created_at);

comment on table public.booking_events is
  'Every status change of a booking: from, to, who (customer, provider, admin, system, stripe) and when. Written by a trigger. Never changed or deleted.';

create or replace function public.bookings_log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.booking_events (booking_id, from_status, to_status, actor)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.status_changed_by);
  end if;
  return null;
end;
$$;
comment on function public.bookings_log_status() is
  'Trigger function: records each booking status change in booking_events.';

create trigger bookings_log_status
  after insert or update of status on public.bookings
  for each row execute function public.bookings_log_status();

-- ---------------------------------------------------------------------------
-- BOOKING CONTACTS AND ADDRESSES
-- ---------------------------------------------------------------------------

-- Separate tables because access is per row: the provider reads these only
-- once the booking is accepted or confirmed (confirmed_at is set).
create table public.booking_contacts (
  booking_id uuid primary key references public.bookings (id) on delete restrict,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  phone text check (char_length(phone) between 7 and 30)
);
comment on table public.booking_contacts is
  'The customer''s email and optional phone for a booking. The provider reads them only once the booking is accepted or confirmed. Never deleted.';

create table public.booking_addresses (
  booking_id uuid primary key references public.bookings (id) on delete restrict,
  line1 text not null check (char_length(line1) between 3 and 200),
  line2 text check (char_length(line2) <= 200),
  city text not null check (char_length(city) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  instructions text check (char_length(instructions) <= 500)
);
comment on table public.booking_addresses is
  'Where an "I come to you" Service takes place: the customer''s address. The provider reads it only once the booking is accepted. Never deleted.';

-- ---------------------------------------------------------------------------
-- ROW ACCESS (RLS): read only, for the people a booking concerns
-- ---------------------------------------------------------------------------

alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.booking_contacts enable row level security;
alter table public.booking_addresses enable row level security;

create policy bookings_read_customer on public.bookings for select to authenticated
  using (customer_id = (select auth.uid()));
comment on policy bookings_read_customer on public.bookings is 'Customers can read their own bookings.';
create policy bookings_read_provider on public.bookings for select to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy bookings_read_provider on public.bookings is 'Providers can read bookings of their listings.';
create policy bookings_read_admin on public.bookings for select to authenticated
  using ((select public.is_admin()));
comment on policy bookings_read_admin on public.bookings is 'Admins can read all bookings.';

-- Through the booking: a row is readable if its booking is.
create policy booking_events_read on public.booking_events for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));
comment on policy booking_events_read on public.booking_events is
  'Anyone who can read a booking can read its history (customer, provider, admin).';

create policy booking_contacts_read_customer on public.booking_contacts for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = (select auth.uid())));
comment on policy booking_contacts_read_customer on public.booking_contacts is 'Customers can read their own contact details.';
create policy booking_contacts_read_provider on public.booking_contacts for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                   and b.provider_id = (select public.current_provider_id()) and b.confirmed_at is not null));
comment on policy booking_contacts_read_provider on public.booking_contacts is
  'Providers can read a customer''s email and phone once the booking is accepted or confirmed.';
create policy booking_contacts_read_admin on public.booking_contacts for select to authenticated
  using ((select public.is_admin()));
comment on policy booking_contacts_read_admin on public.booking_contacts is 'Admins can read all booking contacts.';

create policy booking_addresses_read_customer on public.booking_addresses for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = (select auth.uid())));
comment on policy booking_addresses_read_customer on public.booking_addresses is 'Customers can read the address they gave.';
create policy booking_addresses_read_provider on public.booking_addresses for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                   and b.provider_id = (select public.current_provider_id()) and b.confirmed_at is not null));
comment on policy booking_addresses_read_provider on public.booking_addresses is
  'Providers can read the customer''s address once the booking is accepted.';
create policy booking_addresses_read_admin on public.booking_addresses for select to authenticated
  using ((select public.is_admin()));
comment on policy booking_addresses_read_admin on public.booking_addresses is 'Admins can read all booking addresses.';

-- No writes for signed-in users or the public on any of them; never deleted.
revoke all on public.bookings, public.booking_events, public.booking_contacts, public.booking_addresses from anon;
revoke insert, update, delete on public.bookings, public.booking_events, public.booking_contacts, public.booking_addresses
  from authenticated;

-- ---------------------------------------------------------------------------
-- LISTING ADDRESSES: customers with a confirmed booking
-- ---------------------------------------------------------------------------

create policy listing_addresses_read_booked_customer on public.listing_addresses for select to authenticated
  using (exists (select 1 from public.bookings b
                 where b.listing_id = listing_addresses.listing_id
                   and b.customer_id = (select auth.uid())
                   and b.status in ('confirmed', 'completed', 'paid_out')));
comment on policy listing_addresses_read_booked_customer on public.listing_addresses is
  'Customers with an accepted or confirmed booking (not cancelled) can read the listing''s exact address.';

-- ---------------------------------------------------------------------------
-- SPOTS
-- ---------------------------------------------------------------------------

-- Spots taken: confirmed bookings (and those that went on to happen), plus
-- reservations still inside their checkout window.
create or replace function public.session_spots_taken(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(party_size), 0)::integer from public.bookings
  where session_id = p_session_id
    and (status in ('confirmed', 'completed', 'paid_out')
         or (status = 'pending_payment' and reserved_until > now()));
$$;
comment on function public.session_spots_taken(uuid) is
  'Spots booked or reserved (unexpired checkout) in a session.';
revoke execute on function public.session_spots_taken(uuid) from public, anon, authenticated;

-- Spots left, for a session the caller may see: a public one (scheduled,
-- future, on a visible listing), one of their own listings, or any for the
-- admin. Null otherwise, so hidden sessions' numbers don't leak. Security
-- definer because the count reads bookings the caller can't.
create or replace function public.session_spots_left(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(s.capacity - public.session_spots_taken(s.id), 0)
  from public.experience_sessions s
  join public.listings l on l.id = s.listing_id
  where s.id = p_session_id
    and ((s.status = 'scheduled' and s.starts_at > now() and l.status = 'live'
          and public.listing_parents_active(l.provider_id, l.category_id, l.city_id))
         or l.provider_id = public.current_provider_id()
         or public.is_admin());
$$;
comment on function public.session_spots_left(uuid) is
  'Spots left in a session (capacity minus booked and reserved spots), for a session the caller may see; null otherwise.';
revoke execute on function public.session_spots_left(uuid) from public;
grant execute on function public.session_spots_left(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- CREATING BOOKINGS (the server calls these)
-- ---------------------------------------------------------------------------

-- Price and commission come from the listing and the rate in force, here,
-- so the server can't get them wrong.
create or replace function public.booking_money(p_kind text, p_unit_price integer, p_party smallint,
  out total integer, out rate integer, out commission integer, out provider_amount integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  select rate_bps into rate from public.commission_rates where kind = p_kind;
  total := p_unit_price * p_party;
  commission := round(total * rate / 10000.0)::integer;
  provider_amount := total - commission;
end;
$$;
comment on function public.booking_money(text, integer, smallint) is
  'Internal: total, commission rate, commission and provider share for a booking.';
revoke execute on function public.booking_money(text, integer, smallint) from public, anon, authenticated;

-- An Experience booking: locks the session so two checkouts can't both take
-- the last spot, checks it's bookable, and reserves the spots until
-- p_reserved_until (Checkout's window).
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
    raise exception 'There aren''t enough spots left for % people.', p_party_size using errcode = 'check_violation';
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
comment on function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz) is
  'Server only: reserves spots in a session for a customer''s checkout, with the price and commission worked out here; refuses if the session isn''t bookable or the spots aren''t there.';

-- A Service request: up to three distinct times, each at least 24 hours ahead.
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
    reserved_until, status_changed_by)
  values ('service', v_listing.id, v_listing.provider_id, p_customer_id, p_preferred_times, p_customer_name,
    nullif(p_customer_notes, ''), v_listing.price_cents, v_money.total, v_money.rate, v_money.commission,
    v_money.provider_amount, p_reserved_until, 'customer')
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
comment on function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz) is
  'Server only: creates a Service request (pending payment) with up to three preferred times, the customer''s contact details and, for "I come to you", their address; price and commission worked out here.';

revoke execute on function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_experience_booking(uuid, uuid, smallint, text, text, text, text, timestamptz) to service_role;
grant execute on function public.create_service_request(uuid, uuid, timestamptz[], text, text, text, text, jsonb, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- SESSIONS WITH BOOKINGS
-- ---------------------------------------------------------------------------

-- Customers booked a session at its time with its spots, so a provider can't
-- move it, shrink it below what's booked, or cancel it themselves once it has
-- bookings: cancelling goes through the server, which refunds everyone.
-- Bookings reference sessions with `restrict`, so it can't be deleted either.
create or replace function public.experience_sessions_booked_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken integer;
begin
  v_taken := public.session_spots_taken(new.id);
  if new.capacity < v_taken then
    raise exception 'This session already has % spots booked, so it can''t have fewer.', v_taken
      using errcode = 'check_violation';
  end if;
  -- Security definer (to count bookings the provider can't read), so
  -- current_user is the owner here; the caller's role comes from their claims.
  if (select auth.role()) = 'authenticated' and v_taken > 0 then
    if new.starts_at is distinct from old.starts_at then
      raise exception 'This session has bookings, so its time can''t change.' using errcode = 'check_violation';
    end if;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      raise exception 'This session has bookings. Cancel it from your Sessions so everyone is refunded.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
comment on function public.experience_sessions_booked_guard() is
  'Trigger function: a session can''t have fewer spots than are booked; with bookings, a provider can''t move or cancel it directly (the server cancels it with refunds).';

create trigger experience_sessions_booked_guard
  before update of capacity, starts_at, status on public.experience_sessions
  for each row execute function public.experience_sessions_booked_guard();

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS: bookings tell the provider
-- ---------------------------------------------------------------------------

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in (
    'listing_approved', 'listing_rejected', 'listing_unpublished', 'listing_restored',
    'booking_requested', 'booking_confirmed', 'booking_cancelled'));
alter table public.notifications
  add column booking_id uuid references public.bookings (id) on delete restrict;
comment on column public.notifications.booking_id is
  'For booking notifications: the booking it''s about.';

-- New request (Service checkout done), new booking (Experience paid), and a
-- cancellation by the customer, admin or system. Not the provider's own acts.
create or replace function public.bookings_notify_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  v_kind := case
    when new.status = 'requested' then 'booking_requested'
    when new.status = 'confirmed' and new.kind = 'experience' then 'booking_confirmed'
    when new.status = 'cancelled' and new.cancelled_by <> 'provider' and old.status in ('requested', 'confirmed') then 'booking_cancelled'
  end;
  if v_kind is not null then
    insert into public.notifications (provider_id, kind, listing_id, booking_id)
    values (new.provider_id, v_kind, new.listing_id, new.id);
  end if;
  return null;
end;
$$;
comment on function public.bookings_notify_provider() is
  'Trigger function: notifies the provider of a new request, a paid Experience booking, or a cancellation they didn''t make.';

create trigger bookings_notify_provider
  after update of status on public.bookings
  for each row when (old.status is distinct from new.status)
  execute function public.bookings_notify_provider();
