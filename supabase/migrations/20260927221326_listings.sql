-- Listings, their private addresses, and where "I come to you" Services
-- travel (build step 3 of docs/design/categories-and-listings.md).
--
-- One table for both kinds; the kind-specific rules are check constraints.
-- Status and review fields are server-only: publishing, submitting and
-- unlisting happen in server routes that re-check the design's conditions.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

-- Policies on listings and their child tables need to ask "is this provider,
-- category and city active?" and "which provider am I?". Signed-out visitors
-- can't read providers at all, and a policy subquery runs with the caller's
-- rights, so these helpers are security definer: they answer the one
-- question and return nothing else.

create or replace function public.current_provider_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.providers where owner_id = auth.uid();
$$;
comment on function public.current_provider_id() is
  'The signed-in user''s provider id, or null. For RLS policies.';

create or replace function public.listing_parents_active(
  p_provider_id uuid, p_category_id uuid, p_city_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.providers where id = p_provider_id and status = 'active')
    and exists (select 1 from public.categories where id = p_category_id and active)
    and exists (select 1 from public.cities where id = p_city_id and active);
$$;
comment on function public.listing_parents_active(uuid, uuid, uuid) is
  'True when a listing''s provider, category and city are all active. Part of the public visibility rule.';

-- ---------------------------------------------------------------------------
-- LISTINGS
-- ---------------------------------------------------------------------------

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete restrict,
  kind text not null check (kind in ('service', 'experience')),
  category_id uuid not null,
  city_id uuid not null references public.cities (id) on delete restrict,
  title text not null check (char_length(title) between 5 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null check (char_length(description) between 20 and 5000),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  duration_minutes integer check (duration_minutes between 5 and 1440),
  location_mode text check (location_mode in ('provider_location', 'customer_location')),
  area_id uuid references public.service_areas (id) on delete restrict,

  -- Server-only (no grants to signed-in users; see below).
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'live', 'rejected', 'unpublished')),
  rejection_reason text check (char_length(rejection_reason) <= 1000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The composite reference: a Service can only use a Service category.
  foreign key (category_id, kind) references public.categories (id, kind) on delete restrict,

  -- Kind-specific rules from the design.
  constraint listings_experience_shape check (
    kind <> 'experience' or (duration_minutes is not null and location_mode is null)
  ),
  constraint listings_service_shape check (
    kind <> 'service' or location_mode is not null
  ),
  -- Everything but an "I come to you" Service shows an area as its location.
  constraint listings_area_required check (
    (kind = 'service' and location_mode = 'customer_location') or area_id is not null
  ),
  -- A rejected listing always says why.
  constraint listings_rejection_reason check (
    status <> 'rejected' or rejection_reason is not null
  )
);

comment on table public.listings is
  'A Service or Experience a provider offers. Deleted only while it has never been live (published_at is null); after that it is unlisted or unpublished, never deleted, because bookings will point at it.';
comment on column public.listings.kind is
  'service or experience. Fixed at creation.';
comment on column public.listings.category_id is
  'A category of the same kind, enforced by the (category_id, kind) reference.';
comment on column public.listings.slug is
  'Generated from the title with a short random suffix when the listing is created. Used by public listing pages; not changed afterwards.';
comment on column public.listings.price_cents is
  'Whole price in cents for a Service; per person for an Experience.';
comment on column public.listings.duration_minutes is
  'Required for Experiences; optional for Services.';
comment on column public.listings.location_mode is
  'Services only: provider_location (customer comes to the provider) or customer_location (provider travels, within listing_service_areas). Null for Experiences.';
comment on column public.listings.area_id is
  'The public location label, e.g. Old Fourth Ward. Required for provider-location Services and Experiences. Must be in the listing''s city.';
comment on column public.listings.status is
  'draft, submitted, live, rejected or unpublished. Changed only by server routes.';
comment on column public.listings.rejection_reason is
  'Why an Experience was sent back. Set on rejection; cleared on resubmission.';
comment on column public.listings.published_at is
  'Set the first time the listing goes live and never cleared.';

create index listings_provider_id_idx on public.listings (provider_id);
create index listings_live_city_category_idx on public.listings (city_id, category_id) where status = 'live';

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- Slug: generated in the database so every listing gets one, and no one can
-- pick a slug that collides with or impersonates another listing's URL.
create or replace function public.listings_set_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(new.title), '[^a-z0-9]+', '-', 'g'));
begin
  new.slug := coalesce(nullif(left(v_base, 60), ''), 'listing')
    || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6);
  return new;
end;
$$;
comment on function public.listings_set_slug() is
  'Trigger function: sets a listing''s slug from its title plus a random suffix on insert.';

create trigger listings_set_slug
  before insert on public.listings
  for each row execute function public.listings_set_slug();

-- ---------------------------------------------------------------------------
-- LISTINGS: references must be active, and the area in the listing's city
-- ---------------------------------------------------------------------------

-- The same pattern as providers.city_id: checked only on insert or when the
-- column changes, so a listing whose category, city or area is deactivated
-- later can still be edited. Category is included too: it's the same kind
-- of admin-managed reference.
create or replace function public.listings_check_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_insert boolean := tg_op = 'INSERT';
begin
  if v_is_insert or new.category_id is distinct from old.category_id then
    if not exists (select 1 from public.categories where id = new.category_id and active) then
      raise exception 'Choose one of the listed categories.' using errcode = 'check_violation';
    end if;
  end if;

  if v_is_insert or new.city_id is distinct from old.city_id then
    if not exists (select 1 from public.cities where id = new.city_id and active) then
      raise exception 'Choose one of the listed cities.' using errcode = 'check_violation';
    end if;
  end if;

  -- The area is rechecked when it changes, and also when the city changes,
  -- since it has to be in the listing's city.
  if new.area_id is not null
     and (v_is_insert or new.area_id is distinct from old.area_id or new.city_id is distinct from old.city_id) then
    if not exists (select 1 from public.service_areas where id = new.area_id and active) then
      raise exception 'Choose one of the listed areas.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.service_areas where id = new.area_id and city_id = new.city_id) then
      raise exception 'Choose an area in the listing''s city.' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
comment on function public.listings_check_references() is
  'Trigger function: category, city and area must be active when set or changed, and the area must be in the listing''s city.';

create trigger listings_check_references
  before insert or update of category_id, city_id, area_id on public.listings
  for each row execute function public.listings_check_references();

-- ---------------------------------------------------------------------------
-- LISTINGS: what a provider may change, by status
-- ---------------------------------------------------------------------------

-- Providers edit draft and rejected listings freely. A live listing may only
-- change its price and description (design: Listing states); a submitted or
-- unpublished one can't be edited at all. The server (service role) is not
-- limited, because status changes go through it.
create or replace function public.listings_guard_provider_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if old.status in ('draft', 'rejected') then
    return new;
  end if;

  if old.status = 'live'
     and new.category_id is not distinct from old.category_id
     and new.city_id is not distinct from old.city_id
     and new.title is not distinct from old.title
     and new.duration_minutes is not distinct from old.duration_minutes
     and new.location_mode is not distinct from old.location_mode
     and new.area_id is not distinct from old.area_id then
    return new;
  end if;

  raise exception using
    errcode = 'check_violation',
    message = case old.status
      when 'live' then 'A live listing can only change its price and description. Unlist it to change anything else.'
      else 'This listing can''t be edited while it is ' || old.status || '.'
    end;
end;
$$;
comment on function public.listings_guard_provider_edits() is
  'Trigger function: providers edit draft and rejected listings freely, live listings only in price and description, and submitted or unpublished listings not at all.';

create trigger listings_guard_provider_edits
  before update on public.listings
  for each row execute function public.listings_guard_provider_edits();

-- ---------------------------------------------------------------------------
-- LISTINGS: row access (RLS)
-- ---------------------------------------------------------------------------

alter table public.listings enable row level security;

create policy listings_read_public
  on public.listings for select to anon, authenticated
  using (status = 'live' and public.listing_parents_active(provider_id, category_id, city_id));
comment on policy listings_read_public on public.listings is
  'Anyone can read visible listings: live, with an active provider, category and city.';

create policy listings_read_own
  on public.listings for select to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy listings_read_own on public.listings is
  'Providers can read all their own listings, in any status.';

create policy listings_read_admin
  on public.listings for select to authenticated
  using ((select public.is_admin()));
comment on policy listings_read_admin on public.listings is
  'Admins can read all listings.';

create policy listings_insert_own
  on public.listings for insert to authenticated
  with check (provider_id = (select public.current_provider_id()) and status = 'draft');
comment on policy listings_insert_own on public.listings is
  'Providers can create listings, only under their own provider record and only as drafts.';

create policy listings_update_own
  on public.listings for update to authenticated
  using (provider_id = (select public.current_provider_id()))
  with check (provider_id = (select public.current_provider_id()));
comment on policy listings_update_own on public.listings is
  'Providers can update their own listings (which fields, by status, is limited by a trigger and the column grants).';

create policy listings_delete_own_unpublished
  on public.listings for delete to authenticated
  using (provider_id = (select public.current_provider_id()) and published_at is null);
comment on policy listings_delete_own_unpublished on public.listings is
  'Providers can delete their own listings that have never been live.';

-- Column access. Revoke writes, then grant back what providers may set.
-- Status and review fields stay server-only, like providers.status.
revoke insert, update, delete on public.listings from anon;
revoke insert, update on public.listings from authenticated;
grant insert (provider_id, kind, category_id, city_id, title, description, price_cents,
              duration_minutes, location_mode, area_id)
  on public.listings to authenticated;
grant update (category_id, city_id, title, description, price_cents,
              duration_minutes, location_mode, area_id)
  on public.listings to authenticated;
-- Delete stays granted to signed-in users; the policy above limits it to
-- the owner's never-published listings.

-- ---------------------------------------------------------------------------
-- LISTING ADDRESSES
-- ---------------------------------------------------------------------------

-- Kept out of listings because access rules work per row, not per column:
-- anyone who can read a listing could otherwise read its address.
create table public.listing_addresses (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  line1 text not null check (char_length(line1) between 3 and 200),
  line2 text check (char_length(line2) <= 200),
  city text not null check (char_length(city) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  instructions text check (char_length(instructions) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.listing_addresses is
  'A listing''s exact address. Private: readable only by the listing''s provider and the admin (customers with a confirmed booking come later). Required for provider-location Services and Experiences before publishing or submitting. Deleted with its listing, or by the provider when it is no longer needed.';
comment on column public.listing_addresses.instructions is
  'Optional arrival notes, e.g. "Side entrance, ring twice".';

create trigger listing_addresses_set_updated_at
  before update on public.listing_addresses
  for each row execute function public.set_updated_at();

alter table public.listing_addresses enable row level security;

create policy listing_addresses_read_own
  on public.listing_addresses for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_addresses_read_own on public.listing_addresses is
  'Providers can read the addresses of their own listings.';

create policy listing_addresses_read_admin
  on public.listing_addresses for select to authenticated
  using ((select public.is_admin()));
comment on policy listing_addresses_read_admin on public.listing_addresses is
  'Admins can read all listing addresses.';

create policy listing_addresses_write_own
  on public.listing_addresses for all to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())))
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_addresses_write_own on public.listing_addresses is
  'Providers can add, change and remove the addresses of their own listings.';

-- No access at all for signed-out visitors, even to live listings' addresses.
revoke all on public.listing_addresses from anon;

-- ---------------------------------------------------------------------------
-- LISTING SERVICE AREAS
-- ---------------------------------------------------------------------------

create table public.listing_service_areas (
  listing_id uuid not null references public.listings (id) on delete cascade,
  service_area_id uuid not null references public.service_areas (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (listing_id, service_area_id)
);

comment on table public.listing_service_areas is
  'Where an "I come to you" Service travels. At least one row is required before a customer-location Service can go live. Rows go with their listing; the provider removes a row to stop covering an area.';

create index listing_service_areas_service_area_id_idx on public.listing_service_areas (service_area_id);

-- Only customer-location Services have travel areas, and each area must be
-- active and in the listing's city when it's added.
create or replace function public.listing_service_areas_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = new.listing_id;
  if v_listing.kind <> 'service' or v_listing.location_mode is distinct from 'customer_location' then
    raise exception 'Only "I come to you" Services have travel areas.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.service_areas
                 where id = new.service_area_id and active and city_id = v_listing.city_id) then
    raise exception 'Choose one of the listed areas in the listing''s city.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.listing_service_areas_check() is
  'Trigger function: travel areas belong to customer-location Services, and each must be active and in the listing''s city.';

create trigger listing_service_areas_check
  before insert on public.listing_service_areas
  for each row execute function public.listing_service_areas_check();

alter table public.listing_service_areas enable row level security;

-- Visitors see where a visible Service travels. The listings subquery runs
-- under the caller's RLS, so it only finds listings they may already see.
create policy listing_service_areas_read_public
  on public.listing_service_areas for select to anon, authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.status = 'live'
                   and public.listing_parents_active(l.provider_id, l.category_id, l.city_id)));
comment on policy listing_service_areas_read_public on public.listing_service_areas is
  'Anyone can read the travel areas of visible listings.';

create policy listing_service_areas_read_own
  on public.listing_service_areas for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_service_areas_read_own on public.listing_service_areas is
  'Providers can read the travel areas of their own listings.';

create policy listing_service_areas_read_admin
  on public.listing_service_areas for select to authenticated
  using ((select public.is_admin()));
comment on policy listing_service_areas_read_admin on public.listing_service_areas is
  'Admins can read all travel areas.';

create policy listing_service_areas_insert_own
  on public.listing_service_areas for insert to authenticated
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_service_areas_insert_own on public.listing_service_areas is
  'Providers can add travel areas to their own listings.';

create policy listing_service_areas_delete_own
  on public.listing_service_areas for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy listing_service_areas_delete_own on public.listing_service_areas is
  'Providers can remove travel areas from their own listings.';

-- Rows are added and removed, never edited: changing an area is remove + add,
-- which runs the check above.
revoke insert, update, delete on public.listing_service_areas from anon;
revoke update on public.listing_service_areas from authenticated;

-- ---------------------------------------------------------------------------
-- STATUS RULES FOR ADDRESSES AND TRAVEL AREAS
-- ---------------------------------------------------------------------------

-- The same idea as listings_guard_provider_edits, for the listing's details:
--   draft, rejected       free
--   submitted, unpublished locked
--   live                  address locked; travel areas can change, except
--                         that the last one can't be removed
-- The status locks apply to providers (the server isn't limited). The last
-- travel area rule applies to everyone: a live "I come to you" Service with
-- nowhere to travel can't be booked.
-- When the caller can't see the listing at all (another provider's draft),
-- the guards step aside and RLS refuses the write with its usual error.
-- Cascade deletes from a listing run as the table owner, not as the
-- provider, so the status locks don't apply to them.

create or replace function public.listing_addresses_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  select status into v_status from public.listings where id = coalesce(new.listing_id, old.listing_id);
  if v_status is null or v_status in ('draft', 'rejected') then
    return coalesce(new, old);
  end if;
  raise exception using
    errcode = 'check_violation',
    message = case v_status
      when 'live' then 'A live listing''s address can''t be changed. Unlist it first.'
      else 'This listing''s address can''t be changed while it is ' || v_status || '.'
    end;
end;
$$;
comment on function public.listing_addresses_guard() is
  'Trigger function: providers change a listing''s address only while it is a draft or rejected.';

create trigger listing_addresses_guard
  before insert or update or delete on public.listing_addresses
  for each row execute function public.listing_addresses_guard();

create or replace function public.listing_service_areas_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing_id uuid := coalesce(new.listing_id, old.listing_id);
  v_status text;
begin
  select status into v_status from public.listings where id = v_listing_id;
  if v_status is null then
    return coalesce(new, old);
  end if;

  if current_user = 'authenticated' and v_status in ('submitted', 'unpublished') then
    raise exception 'This listing''s travel areas can''t be changed while it is %.', v_status
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' and v_status = 'live'
     and not exists (select 1 from public.listing_service_areas
                     where listing_id = v_listing_id and service_area_id <> old.service_area_id) then
    raise exception 'A live "I come to you" Service needs at least one travel area. Add another area first, or unlist it.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;
comment on function public.listing_service_areas_guard() is
  'Trigger function: providers change travel areas while a listing is a draft, rejected or live, never while submitted or unpublished; nobody removes the last travel area of a live listing.';

create trigger listing_service_areas_guard
  before insert or delete on public.listing_service_areas
  for each row execute function public.listing_service_areas_guard();
