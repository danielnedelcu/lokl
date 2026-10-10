-- Access rules that check visibility once per query, not once per row
-- (docs/TODO.md, Hardening: "Access rules evaluated once per query, with a
-- guard"; decided 2026-10-10).
--
-- Visitors' read rules called listing_parents_active(provider, category,
-- city) for every row, and the sessions rule again for every session row;
-- reviews and ratings called provider_is_public(provider) per row. Both take
-- the row's own values, so wrapping them as (select ...) can't help, and as
-- security definer functions Postgres can't fold them into the query. At
-- about 4,800 live listings (local load seed) a visitor's category count
-- took about 26 ms against about 2 ms without the rules.
--
-- Now each rule asks whether the row's provider, category and city are in
-- sets computed once per query: the same three conditions as
-- listing_parents_active() (provider active, category active, city
-- active), and for reviews and ratings the same as provider_is_public()
-- (provider active, with a visible listing). The three reviews admin rules
-- also call is_admin() once per query, like every other admin rule.
--
-- policy_guard.test.sql now fails on any read rule that calls a helper per
-- row, or an unwrapped auth.uid(), auth.jwt(), is_admin() or
-- current_provider_id().

-- ---------------------------------------------------------------------------
-- THE SETS (security definer: visitors can't read providers' status, and
-- these must see every row to decide)
-- ---------------------------------------------------------------------------

create function public.active_provider_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.providers where status = 'active';
$$;

create function public.active_category_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.categories where active;
$$;

create function public.active_city_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.cities where active;
$$;

-- Active providers with at least one visible listing (provider_is_public()
-- for every provider at once).
create function public.public_provider_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.providers p
  where p.status = 'active'
    and exists (select 1 from public.listings l
                join public.categories c on c.id = l.category_id and c.active
                join public.cities ci on ci.id = l.city_id and ci.active
                where l.provider_id = p.id and l.status = 'live');
$$;

comment on function public.active_provider_ids() is
  'Ids of active providers. Used inside visitors'' read rules, as `provider_id in (select public.active_provider_ids())`, so it runs once per query. Called by visitors and signed-in users (the roles those rules are for).';
comment on function public.active_category_ids() is
  'Ids of active categories, for visitors'' read rules (once per query). Called by visitors and signed-in users.';
comment on function public.active_city_ids() is
  'Ids of active cities (markets), for visitors'' read rules (once per query). Called by visitors and signed-in users.';
comment on function public.public_provider_ids() is
  'Ids of providers whose profile is public: active, with a visible listing (as provider_is_public()). For the reviews and ratings read rules (once per query). Called by visitors and signed-in users.';

revoke execute on function public.active_provider_ids(), public.active_category_ids(), public.active_city_ids(), public.public_provider_ids()
  from public, service_role;
grant execute on function public.active_provider_ids(), public.active_category_ids(), public.active_city_ids(), public.public_provider_ids()
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE RULES (same conditions, checked once per query)
-- ---------------------------------------------------------------------------

alter policy listings_read_public on public.listings
  using (status = 'live'
         and provider_id in (select public.active_provider_ids())
         and category_id in (select public.active_category_ids())
         and city_id in (select public.active_city_ids()));

alter policy listing_service_areas_read_public on public.listing_service_areas
  using (exists (select 1 from public.listings l
                 where l.id = listing_service_areas.listing_id and l.status = 'live'
                   and l.provider_id in (select public.active_provider_ids())
                   and l.category_id in (select public.active_category_ids())
                   and l.city_id in (select public.active_city_ids())));

alter policy listing_photos_read_public on public.listing_photos
  using (exists (select 1 from public.listings l
                 where l.id = listing_photos.listing_id and l.status = 'live'
                   and l.provider_id in (select public.active_provider_ids())
                   and l.category_id in (select public.active_category_ids())
                   and l.city_id in (select public.active_city_ids())));

alter policy experience_sessions_read_public on public.experience_sessions
  using (status = 'scheduled' and starts_at > now()
         and exists (select 1 from public.listings l
                     where l.id = experience_sessions.listing_id and l.status = 'live'
                       and l.provider_id in (select public.active_provider_ids())
                       and l.category_id in (select public.active_category_ids())
                       and l.city_id in (select public.active_city_ids())));

alter policy providers_read_public on public.providers
  using (status = 'active'
         and exists (select 1 from public.listings l
                     where l.provider_id = providers.id and l.status = 'live'
                       and l.provider_id in (select public.active_provider_ids())
                       and l.category_id in (select public.active_category_ids())
                       and l.city_id in (select public.active_city_ids())));

alter policy saved_listings_insert_own on public.saved_listings
  with check (customer_id = (select auth.uid())
              and exists (select 1 from public.listings l
                          where l.id = saved_listings.listing_id and l.status = 'live'
                            and l.provider_id in (select public.active_provider_ids())
                            and l.category_id in (select public.active_category_ids())
                            and l.city_id in (select public.active_city_ids())));

alter policy reviews_read_public on public.reviews
  using (status = 'published' and provider_id in (select public.public_provider_ids()));

alter policy provider_ratings_read on public.provider_ratings
  using (provider_id in (select public.public_provider_ids()));

alter policy reviews_read_admin on public.reviews using ((select public.is_admin()));
alter policy review_replies_read_admin on public.review_replies using ((select public.is_admin()));
alter policy review_reports_read_admin on public.review_reports using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- WHO STILL CALLS THE PER-ROW HELPERS
-- ---------------------------------------------------------------------------

-- listing_parents_active(): no access rule uses it now. The booking
-- functions (create_service_request, reserve_experience_booking) call it
-- with the server key; security definer functions run it as the owner.
revoke execute on function public.listing_parents_active(uuid, uuid, uuid) from anon, authenticated;
comment on function public.listing_parents_active(uuid, uuid, uuid) is
  'Whether a listing''s provider, category and city are all active. Called by the booking functions (the server key) and by security definer functions; access rules use the once-per-query sets instead (policy_helpers_once_per_query).';

-- provider_is_public(): still in saved_providers_insert_own, a write rule
-- that checks the one row being saved (signed-in users). Visitors no longer
-- need it.
revoke execute on function public.provider_is_public(uuid) from anon;
