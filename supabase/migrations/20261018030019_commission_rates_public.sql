-- Commission rates are public (decided 2026-10-17): the hosts' Fees page
-- publishes them (docs/design/website-pages.md), read live, so an admin's
-- change shows there at once. Signed-out visitors may read the kind and the
-- rate only: never who changed it (updated_by, an admin's id) or when.
-- Nothing else changes: only admins write the rates.

create policy commission_rates_read_public
  on public.commission_rates for select to anon
  using (true);
comment on policy commission_rates_read_public on public.commission_rates is
  'Anyone can read the commission rates (the kind and the rate): the Fees page publishes them.';

grant select (kind, rate_bps) on public.commission_rates to anon;

comment on table public.commission_rates is
  'lokl''s commission per kind of listing, in basis points (1200 = 12%). Public (the Fees page). Admin-editable. Each booking copies the rate in force when it''s created, so changes never touch past bookings. Never deleted.';
