-- Favourites, "Saved" (docs/design/favourites.md, approved 2026-10-04).
--
-- 1. saved_listings and saved_providers: what each customer saved. Private:
--    each customer reads and changes only their own rows; nobody else (not
--    the provider, not admins, not visitors) can read them, and no counts
--    are kept anywhere.
-- 2. Saving needs something visible now (a live listing with active
--    parents; a provider with a public profile). Unsaving is always allowed.
--    At most 500 of each per customer.
-- 3. my_saved(): the signed-in customer's saved items, each marked available
--    or not, for the Saved page. Something lokl took down, or whose provider
--    was suspended, comes back without its name ("A listing that's no
--    longer available"); something its provider unlisted keeps its name.
--
-- Delete behaviour: a customer's rows go with their login (cascade); a
-- saved listing's rows go with the listing (cascade; only drafts are ever
-- deleted). Providers are never deleted.

-- ---------------------------------------------------------------------------
-- Is this provider's profile public? (Signed-in users can't read other
-- providers' rows, so the rules below ask this function.)
-- ---------------------------------------------------------------------------

create or replace function public.provider_is_public(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.providers p
    where p.id = p_provider_id and p.status = 'active'
      and exists (select 1 from public.listings l
                  where l.provider_id = p.id and l.status = 'live'
                    and public.listing_parents_active(l.provider_id, l.category_id, l.city_id)));
$$;
comment on function public.provider_is_public(uuid) is
  'True while a provider''s profile is public: active, with at least one visible listing (the same rule as providers_read_public). Reveals nothing visitors can''t already see.';
revoke execute on function public.provider_is_public(uuid) from public, anon;
grant execute on function public.provider_is_public(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The tables
-- ---------------------------------------------------------------------------

create table public.saved_listings (
  customer_id uuid not null references auth.users (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, listing_id)
);
comment on table public.saved_listings is
  'Listings a customer saved (their "Saved" list). Private to that customer: nobody else can read it, not even the listing''s provider or admins. Deleted with the customer''s login or the listing.';
create index saved_listings_listing_idx on public.saved_listings (listing_id);

create table public.saved_providers (
  customer_id uuid not null references auth.users (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (customer_id, provider_id)
);
comment on table public.saved_providers is
  'Providers a customer saved (their "Saved" list). Private to that customer: nobody else can read it, not even the provider or admins. Deleted with the customer''s login; providers are never deleted.';
create index saved_providers_provider_idx on public.saved_providers (provider_id);

alter table public.saved_listings enable row level security;
alter table public.saved_providers enable row level security;
revoke all on public.saved_listings, public.saved_providers from anon, authenticated;
grant select, insert (listing_id), delete on public.saved_listings to authenticated;
grant select, insert (provider_id), delete on public.saved_providers to authenticated;
-- customer_id is the signed-in user, set by the database, never sent.
alter table public.saved_listings alter column customer_id set default auth.uid();
alter table public.saved_providers alter column customer_id set default auth.uid();

-- ---------------------------------------------------------------------------
-- 2. Who can do what
-- ---------------------------------------------------------------------------

create policy saved_listings_read_own on public.saved_listings for select to authenticated
  using (customer_id = (select auth.uid()));
comment on policy saved_listings_read_own on public.saved_listings is 'A customer reads their own saved listings. Nobody else reads them.';

create policy saved_listings_insert_own on public.saved_listings for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and exists (select 1 from public.listings l
                where l.id = listing_id and l.status = 'live'
                  and public.listing_parents_active(l.provider_id, l.category_id, l.city_id))
  );
comment on policy saved_listings_insert_own on public.saved_listings is
  'A customer saves a listing for themselves, only while it''s visible (live, with an active provider, category and city).';

create policy saved_listings_delete_own on public.saved_listings for delete to authenticated
  using (customer_id = (select auth.uid()));
comment on policy saved_listings_delete_own on public.saved_listings is 'A customer unsaves their own saved listings, whether or not they''re still visible.';

create policy saved_providers_read_own on public.saved_providers for select to authenticated
  using (customer_id = (select auth.uid()));
comment on policy saved_providers_read_own on public.saved_providers is 'A customer reads their own saved providers. Nobody else reads them.';

create policy saved_providers_insert_own on public.saved_providers for insert to authenticated
  with check (customer_id = (select auth.uid()) and public.provider_is_public(provider_id));
comment on policy saved_providers_insert_own on public.saved_providers is
  'A customer saves a provider for themselves, only while the provider''s profile is public.';

create policy saved_providers_delete_own on public.saved_providers for delete to authenticated
  using (customer_id = (select auth.uid()));
comment on policy saved_providers_delete_own on public.saved_providers is 'A customer unsaves their own saved providers, whether or not they''re still public.';

-- At most 500 of each per customer.
create or replace function public.saved_items_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'saved_listings'
     and (select count(*) from public.saved_listings where customer_id = new.customer_id) >= 500 then
    raise exception 'You''ve saved 500 listings, the most there''s room for. Remove some to save more.' using errcode = 'check_violation';
  end if;
  if tg_table_name = 'saved_providers'
     and (select count(*) from public.saved_providers where customer_id = new.customer_id) >= 500 then
    raise exception 'You''ve saved 500 providers, the most there''s room for. Remove some to save more.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.saved_items_limit() is 'Trigger function: at most 500 saved listings and 500 saved providers per customer.';
create trigger saved_listings_limit before insert on public.saved_listings
  for each row execute function public.saved_items_limit();
create trigger saved_providers_limit before insert on public.saved_providers
  for each row execute function public.saved_items_limit();

-- ---------------------------------------------------------------------------
-- 3. The Saved page
-- ---------------------------------------------------------------------------

-- The signed-in customer's saved items, newest first. Available ones are
-- loaded in full by the website as a visitor would see them; for the rest,
-- only whether a name may be shown: lokl took it down (unpublished,
-- rejected) or suspended its provider: no name; its provider unlisted it,
-- or its category or market closed: its own name.
create or replace function public.my_saved()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'listing_id', s.listing_id,
          'saved_at', s.created_at,
          'available', l.status = 'live' and public.listing_parents_active(l.provider_id, l.category_id, l.city_id),
          'title', case when l.status in ('unpublished', 'rejected') or p.status = 'suspended' then null else l.title end)
        order by s.created_at desc)
      from public.saved_listings s
      join public.listings l on l.id = s.listing_id
      join public.providers p on p.id = l.provider_id
      where s.customer_id = (select auth.uid())), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'provider_id', s.provider_id,
          'saved_at', s.created_at,
          'available', public.provider_is_public(p.id),
          'name', case when p.status = 'suspended' then null else p.display_name end)
        order by s.created_at desc)
      from public.saved_providers s
      join public.providers p on p.id = s.provider_id
      where s.customer_id = (select auth.uid())), '[]'::jsonb));
$$;
comment on function public.my_saved() is
  'The signed-in customer''s saved listings and providers, newest first, each marked available or not. A name is left out for something lokl took down (unpublished, rejected) or whose provider was suspended; kept when its provider unlisted it. Nothing about anyone else.';
revoke execute on function public.my_saved() from public, anon;
grant execute on function public.my_saved() to authenticated;
