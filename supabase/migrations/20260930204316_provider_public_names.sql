-- Public provider names (docs/design/browse-and-listing-pages.md, Data and
-- access). Listing pages show "Hosted by <business name>", and those pages
-- read as a signed-out visitor. Until now signed-out visitors couldn't read
-- providers at all.
--
-- Signed-out visitors (anon) only, and two columns only:
--   * Column grants are per role, not per row. Signed-in users already have
--     read access to every column (their own row, and the admin's all rows,
--     are then chosen by the row policies). A public policy for
--     `authenticated` would let any signed-in user read every column, Stripe
--     fields included, of any provider with a visible listing. So the public
--     rule is for anon, and anon may read id and display_name and nothing else.
--   * Signed-in customers still see the names, because public pages read
--     through a signed-out server client (the design's "How public pages read
--     data").
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- ROW ACCESS (RLS)
-- ---------------------------------------------------------------------------

-- "Has a visible listing" uses the same rule as the public listing pages:
-- live, with an active provider, category and city. The subquery runs under
-- anon's own listings_read_public policy; listing_parents_active() is
-- security definer, so it doesn't loop back into this policy.
create policy providers_read_public
  on public.providers for select to anon
  using (
    status = 'active'
    and exists (select 1 from public.listings l
                where l.provider_id = providers.id and l.status = 'live'
                  and public.listing_parents_active(l.provider_id, l.category_id, l.city_id))
  );
comment on policy providers_read_public on public.providers is
  'Signed-out visitors can read active providers that have at least one visible listing. Column grants limit them to id and display_name.';

-- ---------------------------------------------------------------------------
-- COLUMN ACCESS
-- ---------------------------------------------------------------------------

grant select (id, display_name) on public.providers to anon;

comment on column public.providers.display_name is
  'The business name. Public: shown on the provider''s visible listings ("Hosted by ...").';
