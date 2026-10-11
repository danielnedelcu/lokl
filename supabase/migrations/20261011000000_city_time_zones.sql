-- A market's time zone must be a real zone name (the time-zone guard,
-- 2026-10-10). cities.timezone was already required, with a check on its
-- shape only, so "Mars/Olympus" passed. Every time shown in a market's zone
-- reads it, and marketZone() falls back to Atlanta only when a city wasn't
-- read at all, never for a bad zone.

create function public.is_time_zone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_name);
$$;

comment on function public.is_time_zone(text) is
  'Whether a name is a time zone the database knows (pg_timezone_names), such as America/New_York. Used by the cities check constraint, so it runs as whoever writes cities: admins (signed-in users, under the admin-only rules) and the server.';

-- A check constraint runs as the writer.
revoke execute on function public.is_time_zone(text) from public, anon;
grant execute on function public.is_time_zone(text) to authenticated, service_role;

alter table public.cities add constraint cities_timezone_real check (public.is_time_zone(timezone));

comment on column public.cities.timezone is
  'The market''s time zone, a real IANA name (America/New_York): every booking, session and listing time in this market is shown in it. Required; checked against the database''s zone names.';
