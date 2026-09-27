-- Providers: the businesses and hosts who sell Services and Experiences.
-- One provider per login for now; a members table can come later if a business
-- needs several people managing it.
--
-- Comments on the table, columns and policies (below each object) say what
-- things mean. These `--` comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- SHARED HELPERS
-- ---------------------------------------------------------------------------

-- Reads app_metadata rather than user_metadata: only the service role can
-- write app_metadata, so a user can't grant themselves the role.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

comment on function public.is_admin() is
  'True when the signed-in user''s app_metadata.role is admin. Use in every admin policy.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: stamps updated_at on every update.';

-- ---------------------------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------------------------

-- owner_id restricts rather than cascades: deleting a login must not silently
-- delete the provider (and, later, strand its bookings and payouts).
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 120),
  city text check (char_length(city) <= 120),

  -- Admin-only, through the service role.
  status text not null default 'active' check (status in ('active', 'suspended')),

  -- Copied from Stripe by the server; never taken from request input.
  stripe_account_id text unique,
  stripe_details_submitted boolean not null default false,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.providers is
  'A business or host that sells Services or Experiences. One per login (owner_id is unique). Never deleted: bookings and payouts will point here, so a provider is suspended instead.';
comment on column public.providers.owner_id is
  'The login that owns and manages this provider. A user is a provider exactly when they own a row here. The login cannot be deleted while it owns a provider: suspend or anonymize the provider first.';
comment on column public.providers.display_name is
  'Business or host name shown to customers.';
comment on column public.providers.status is
  'active or suspended. Only admins change it (service role); a suspended provider cannot use provider routes.';
comment on column public.providers.stripe_account_id is
  'The provider''s Stripe Connect Express account. Created by the server on first payout setup.';
comment on column public.providers.stripe_details_submitted is
  'Copied from Stripe: the provider finished the onboarding form. Server-only.';
comment on column public.providers.stripe_charges_enabled is
  'Copied from Stripe: payments can be made to this provider. Server-only.';
comment on column public.providers.stripe_payouts_enabled is
  'Copied from Stripe: Stripe can pay out to the provider''s bank. Server-only.';

create trigger providers_set_updated_at
  before update on public.providers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ROW ACCESS (RLS)
-- ---------------------------------------------------------------------------

alter table public.providers enable row level security;

-- auth.uid() and is_admin() are wrapped in (select ...) so Postgres evaluates
-- them once per query rather than once per row.
create policy providers_read_own
  on public.providers for select to authenticated
  using (owner_id = (select auth.uid()));
comment on policy providers_read_own on public.providers is
  'Owners can read their provider.';

create policy providers_read_admin
  on public.providers for select to authenticated
  using ((select public.is_admin()));
comment on policy providers_read_admin on public.providers is
  'Admins can read all providers.';

create policy providers_insert_own
  on public.providers for insert to authenticated
  with check (owner_id = (select auth.uid()));
comment on policy providers_insert_own on public.providers is
  'Users can create a provider owned by themselves.';

create policy providers_update_own
  on public.providers for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
comment on policy providers_update_own on public.providers is
  'Owners can update their provider (profile columns only; see the column grants).';

-- ---------------------------------------------------------------------------
-- COLUMN ACCESS AND DELETE BEHAVIOUR
-- ---------------------------------------------------------------------------

-- Supabase grants full table privileges to anon and authenticated by default.
-- Revoke writes and grant back only the profile columns, so status and every
-- Stripe column stay server-only: a provider can't mark themselves
-- payout-ready or lift their own suspension.
revoke insert, update on public.providers from anon, authenticated;
grant insert (owner_id, display_name, city) on public.providers to authenticated;
grant update (display_name, city) on public.providers to authenticated;

-- Signed-out visitors have no reason to read providers yet. A public view of
-- safe columns can come with the listing pages.
revoke select on public.providers from anon;

-- Never deleted (see the table comment). Having no delete policy would
-- already make a delete affect 0 rows; revoking the privilege makes it an
-- error instead, so a mistaken delete is visible.
revoke delete on public.providers from anon, authenticated;
