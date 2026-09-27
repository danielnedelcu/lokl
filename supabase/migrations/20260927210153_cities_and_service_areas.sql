-- Cities and service areas, and providers.city_id (build step 1 of
-- docs/design/categories-and-listings.md).
--
-- Replaces the free-text providers.city, which accepted "Atanta" in the
-- walkthrough, with a reference to an admin-managed list of cities.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- CITIES
-- ---------------------------------------------------------------------------

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  -- Format check only: a CHECK can't look up pg_timezone_names. Cities are
  -- entered by the admin, so a typo is caught when session times first render.
  timezone text not null check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cities is
  'The places lokl operates. Admin-managed. Never deleted: providers and listings point here, so a city is deactivated instead.';
comment on column public.cities.slug is
  'URL-safe identifier, e.g. atlanta. Unique.';
comment on column public.cities.state is
  'Two-letter US state code, e.g. GA.';
comment on column public.cities.timezone is
  'IANA time zone name, e.g. America/New_York. Experience session times are entered and shown in it.';
comment on column public.cities.active is
  'Inactive cities are hidden everywhere public and in the provider city picker.';
comment on column public.cities.sort_order is
  'Display order in lists and pickers, lowest first.';

create trigger cities_set_updated_at
  before update on public.cities
  for each row execute function public.set_updated_at();

-- Launch city. Seeded here so every environment has it and the providers
-- backfill below has something to point at.
insert into public.cities (slug, name, state, timezone, sort_order)
values ('atlanta', 'Atlanta', 'GA', 'America/New_York', 0);

-- ---------------------------------------------------------------------------
-- SERVICE AREAS
-- ---------------------------------------------------------------------------

create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities (id) on delete restrict,
  kind text not null check (kind in ('neighborhood', 'zip')),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_id, kind, name),
  check (kind <> 'zip' or name ~ '^[0-9]{5}$')
);

comment on table public.service_areas is
  'Neighborhoods or zip codes within a city. Where "I come to you" Services travel, and the public location label on listings. Admin-managed. Never deleted: listings will point here, so an area is deactivated instead.';
comment on column public.service_areas.kind is
  'neighborhood or zip. A zip area''s name is a five-digit zip code.';
comment on column public.service_areas.name is
  'Shown to customers, e.g. Old Fourth Ward or 30312. Unique per city and kind.';
comment on column public.service_areas.active is
  'Inactive areas are hidden everywhere public.';

create trigger service_areas_set_updated_at
  before update on public.service_areas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ROW ACCESS (RLS): cities and service_areas
-- ---------------------------------------------------------------------------

alter table public.cities enable row level security;
alter table public.service_areas enable row level security;

-- Everyone, signed in or not, may read active rows: the public site and the
-- provider city picker both need them. The admin additionally sees inactive
-- rows. Writes are admin-only, enforced here in the database.
create policy cities_read_active
  on public.cities for select to anon, authenticated
  using (active);
comment on policy cities_read_active on public.cities is
  'Anyone can read active cities.';

create policy cities_read_admin
  on public.cities for select to authenticated
  using ((select public.is_admin()));
comment on policy cities_read_admin on public.cities is
  'Admins can read all cities, including inactive ones.';

create policy cities_insert_admin
  on public.cities for insert to authenticated
  with check ((select public.is_admin()));
comment on policy cities_insert_admin on public.cities is
  'Only admins can add cities.';

create policy cities_update_admin
  on public.cities for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
comment on policy cities_update_admin on public.cities is
  'Only admins can change cities, including deactivating them.';

create policy service_areas_read_active
  on public.service_areas for select to anon, authenticated
  using (active);
comment on policy service_areas_read_active on public.service_areas is
  'Anyone can read active service areas.';

create policy service_areas_read_admin
  on public.service_areas for select to authenticated
  using ((select public.is_admin()));
comment on policy service_areas_read_admin on public.service_areas is
  'Admins can read all service areas, including inactive ones.';

create policy service_areas_insert_admin
  on public.service_areas for insert to authenticated
  with check ((select public.is_admin()));
comment on policy service_areas_insert_admin on public.service_areas is
  'Only admins can add service areas.';

create policy service_areas_update_admin
  on public.service_areas for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
comment on policy service_areas_update_admin on public.service_areas is
  'Only admins can change service areas, including deactivating them.';

-- ---------------------------------------------------------------------------
-- PRIVILEGES AND DELETE BEHAVIOUR: cities and service_areas
-- ---------------------------------------------------------------------------

-- Signed-out visitors only read. Signed-in users keep insert and update
-- privileges, which the admin-only policies above then gate.
revoke insert, update on public.cities, public.service_areas from anon;

-- Never deleted (see the table comments), not even by the admin. Revoking
-- delete makes a mistaken delete an error instead of a silent 0 rows.
revoke delete on public.cities, public.service_areas from anon, authenticated;

-- ---------------------------------------------------------------------------
-- PROVIDERS: city -> city_id
-- ---------------------------------------------------------------------------

-- Add, backfill, require, then drop the old column, in that order, so no
-- provider is ever without a city. Every existing provider is in Atlanta,
-- the only city lokl operates in.
alter table public.providers
  add column city_id uuid references public.cities (id) on delete restrict;

update public.providers
set city_id = (select id from public.cities where slug = 'atlanta');

alter table public.providers alter column city_id set not null;

-- Dropping the column also drops the column grants on it.
alter table public.providers drop column city;

-- For restrict checks when a city is deactivated or retired, and for listing
-- providers by city in the admin app.
create index providers_city_id_idx on public.providers (city_id);

comment on column public.providers.city_id is
  'The city the provider operates in, picked from active cities. Replaces the old free-text city.';

-- city_id is a profile field, so providers may set it, like display_name.
grant insert (city_id), update (city_id) on public.providers to authenticated;

-- ---------------------------------------------------------------------------
-- PROVIDERS: only active cities can be chosen
-- ---------------------------------------------------------------------------

-- The foreign key accepts any city, active or not, because it ignores RLS.
-- A trigger checks activeness, and only when the city is set or changed: a
-- provider whose city is deactivated later can still edit their other fields.
-- Listings will use the same pattern for city_id and area_id.
create or replace function public.providers_check_city_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A missing city is left to the NOT NULL constraint, which reports it clearly.
  if new.city_id is not null and (tg_op = 'INSERT' or new.city_id is distinct from old.city_id) then
    if not exists (
      select 1 from public.cities where id = new.city_id and active
    ) then
      raise exception 'Choose one of the listed cities.'
        using errcode = 'check_violation',
              detail = 'providers.city_id must reference an active city when it is set or changed.';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.providers_check_city_active() is
  'Trigger function: a provider''s city must be active when it is set or changed. An unchanged city that was deactivated later is left alone.';

-- "update of city_id" skips the trigger when an update doesn't mention
-- city_id; the function also skips it when city_id is set to its old value.
create trigger providers_city_active
  before insert or update of city_id on public.providers
  for each row execute function public.providers_check_city_active();
