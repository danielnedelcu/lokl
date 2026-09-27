-- Categories (build step 2 of docs/design/categories-and-listings.md).
--
-- Flat, admin-managed lists: one set for Services, one for Experiences. Each
-- listing will belong to exactly one category of its own kind.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- CATEGORIES
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('service', 'experience')),
  name text not null check (char_length(name) between 2 and 60),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (char_length(description) <= 500),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Category pages will live under a kind (/services/<slug>, /experiences/<slug>),
  -- so a slug only has to be unique within its kind.
  unique (kind, slug),
  -- Lets listings reference (category_id, kind) together, so a Service can't
  -- be filed under an Experience category (the design's composite reference).
  unique (id, kind)
);

comment on table public.categories is
  'Service and Experience categories. Flat and admin-managed; each listing belongs to one category of its own kind. Never deleted: listings will point here, so a category is deactivated instead.';
comment on column public.categories.kind is
  'service or experience. A listing can only use a category of its own kind.';
comment on column public.categories.name is
  'Shown to customers, e.g. Hair and beauty. 2 to 60 characters.';
comment on column public.categories.slug is
  'URL-safe identifier, unique within its kind, e.g. hair-and-beauty.';
comment on column public.categories.description is
  'Optional. Shown on the category page later. Up to 500 characters.';
comment on column public.categories.active is
  'Inactive categories are hidden everywhere public, and so are their listings.';
comment on column public.categories.sort_order is
  'Display order within its kind, lowest first.';

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ROW ACCESS (RLS)
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;

-- Same shape as cities: everyone reads active rows (browse pages, the listing
-- editor), the admin sees all and is the only writer (an admin-only
-- reference list, written from the admin app under these rules).
create policy categories_read_active
  on public.categories for select to anon, authenticated
  using (active);
comment on policy categories_read_active on public.categories is
  'Anyone can read active categories.';

create policy categories_read_admin
  on public.categories for select to authenticated
  using ((select public.is_admin()));
comment on policy categories_read_admin on public.categories is
  'Admins can read all categories, including inactive ones.';

create policy categories_insert_admin
  on public.categories for insert to authenticated
  with check ((select public.is_admin()));
comment on policy categories_insert_admin on public.categories is
  'Only admins can add categories.';

create policy categories_update_admin
  on public.categories for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
comment on policy categories_update_admin on public.categories is
  'Only admins can change categories, including deactivating and reordering them.';

-- ---------------------------------------------------------------------------
-- PRIVILEGES AND DELETE BEHAVIOUR
-- ---------------------------------------------------------------------------

-- Signed-out visitors only read. Signed-in users keep insert and update
-- privileges, which the admin-only policies above then gate.
revoke insert, update on public.categories from anon;

-- A category's kind is fixed once created: listings of that kind will point
-- at it, and moving it to the other kind would break the composite rule.
-- A column-level revoke can't take kind away while the table-level UPDATE
-- privilege remains, so revoke UPDATE and grant back the editable columns.
revoke update on public.categories from authenticated;
grant update (name, slug, description, active, sort_order) on public.categories to authenticated;

-- Never deleted (see the table comment), not even by the admin. Revoking
-- delete makes a mistaken delete an error instead of a silent 0 rows.
revoke delete on public.categories from anon, authenticated;
