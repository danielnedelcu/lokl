-- Public content versions (decided 2026-10-18): the website's public routes
-- are cached for up to 60 seconds, in each running copy's own memory. A
-- change someone makes on purpose (a listing going live or taken down, a
-- provider suspended, a guide published, a category switched off) now shows
-- at once instead: it raises its scope's number here, and the cached routes
-- include the numbers in their cache keys, so the next request after the
-- change is answered fresh, on every copy of the website, wherever it runs.
--
-- Three scopes for the whole site:
--   listings  listings, their photos, areas and ratings; providers and their
--             ratings; reviews and replies (browse, search, the homepage's
--             listings, provider pages, the listings inside guides)
--   markets   cities, categories, service areas
--   guides    guides, guide photos, the homepage's guides
-- Spots left and open days (bookings, experience sessions, weekly hours,
-- open days) stay on the 60-second limit: bookings happen all the time, and
-- the booking pages check spots live. scripts/check-public-cache.mjs fails
-- on a table a cached route reads that's neither here nor on its TTL list.

-- ---------------------------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------------------------

create table public.public_content_versions (
  scope text primary key check (scope in ('listings', 'markets', 'guides')),
  version bigint not null default 0,
  changed_at timestamptz not null default now()
);
comment on table public.public_content_versions is
  'One number per scope of public content (listings, markets, guides), raised by triggers whenever that content changes. The website''s cached public routes include the numbers in their cache keys, so a change shows at once. Three fixed rows, never deleted; only the triggers write them.';
comment on column public.public_content_versions.version is
  'Raised by one for every statement that changes this scope''s content.';

insert into public.public_content_versions (scope) values ('listings'), ('markets'), ('guides');

-- ---------------------------------------------------------------------------
-- ACCESS: anyone may read the three numbers; signed-in users and visitors
-- write nothing. The server key keeps its usual rights (as on every table),
-- but no code writes here: a stray write would only clear the caches.
-- Never deleted.
-- ---------------------------------------------------------------------------

alter table public.public_content_versions enable row level security;
create policy public_content_versions_read
  on public.public_content_versions for select to anon, authenticated
  using (true);
comment on policy public_content_versions_read on public.public_content_versions is
  'Anyone, signed in or not, can read the content versions: three numbers, nothing private.';
revoke all on public.public_content_versions from anon, authenticated;
grant select on public.public_content_versions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE TRIGGERS: one per source table, after each statement that writes it
-- ---------------------------------------------------------------------------

-- Security definer, so a provider editing their listing (who can't write
-- this table) still raises the number. Statement-level: one raise per
-- statement, however many rows it changes.
create function public.public_content_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.public_content_versions
     set version = version + 1, changed_at = now()
   where scope = tg_argv[0];
  if not found then
    raise exception 'public_content_changed: unknown scope %', tg_argv[0];
  end if;
  return null;
end;
$$;
comment on function public.public_content_changed() is
  'Trigger: raises the public content version of the scope named in its argument (listings, markets, guides), so the website''s cached public routes answer fresh.';
revoke execute on function public.public_content_changed() from public, anon, authenticated, service_role;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('listings', 'listings'), ('listing_photos', 'listings'), ('listing_service_areas', 'listings'),
      ('listing_ratings', 'listings'), ('providers', 'listings'), ('provider_ratings', 'listings'),
      ('reviews', 'listings'), ('review_replies', 'listings'),
      ('cities', 'markets'), ('categories', 'markets'), ('service_areas', 'markets'),
      ('guides', 'guides'), ('guide_photos', 'guides'), ('homepage_features', 'guides')
    ) as v(tbl, scope)
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public.public_content_changed(%L)',
      t.tbl || '_public_content', t.tbl, t.scope);
    execute format(
      'create trigger %I after truncate on public.%I for each statement execute function public.public_content_changed(%L)',
      t.tbl || '_public_content_truncate', t.tbl, t.scope);
  end loop;
end;
$$;
