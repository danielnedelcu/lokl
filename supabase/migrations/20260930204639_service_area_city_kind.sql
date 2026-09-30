-- Cities and towns as areas within a market (docs/decisions.md, 2026-09-30).
--
-- A row in `cities` is a market: Atlanta covers the whole metro. Surrounding
-- cities such as Decatur, Sandy Springs, Alpharetta and Marietta are areas
-- inside the Atlanta market, not markets of their own, so a provider can list
-- them as places they travel to alongside neighborhoods and zip codes. The
-- table keeps its name; renaming it would touch every migration and query for
-- no change in behaviour.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

alter table public.service_areas
  drop constraint service_areas_kind_check,
  add constraint service_areas_kind_check check (kind in ('neighborhood', 'city', 'zip'));

comment on table public.cities is
  'The markets lokl operates in, each named after its main city and covering its metro area (Atlanta covers Decatur, Marietta and so on). Admin-managed. Never deleted: providers and listings point here, so a market is deactivated instead.';
comment on table public.service_areas is
  'Areas within a market: neighborhoods, cities or towns, and zip codes. Where "I come to you" Services travel, and the public location label on listings. Admin-managed. Never deleted: listings will point here, so an area is deactivated instead.';
comment on column public.service_areas.city_id is
  'The market this area belongs to.';
comment on column public.service_areas.kind is
  'neighborhood (e.g. Old Fourth Ward), city (a city or town within the market, e.g. Decatur) or zip (a five-digit zip code).';
comment on column public.service_areas.name is
  'Shown to customers, e.g. Old Fourth Ward, Decatur or 30312. Unique per market and kind.';
