-- The admin login never owns a provider (CLAUDE.md, Roles; docs/TODO.md,
-- Next migration). Admin read rules return every row, so an admin who is
-- also a provider makes own-rows bugs invisible, and mixes the owner's tools
-- with a business's.
--
-- There are two ways in, and only one is guarded here:
--   * A provider created for, or moved to, an admin login: refused by the
--     trigger below, for everyone (apps, server and SQL Editor).
--   * An existing business owner being made an admin: deliberately NOT a
--     trigger. That would have to sit on auth.users, Supabase's own sign-in
--     table, which Supabase Auth writes on every sign-in; a bug or error there
--     could stop everyone signing in. It also only happens when the owner
--     grants admin by hand in the SQL Editor, so the admin-grant SQL in
--     CLAUDE.md and docs/TODO.md checks it instead, and refuses with a clear
--     message. (docs/decisions.md, 2026-09-27.)
--
-- The role is read from auth.users.raw_app_meta_data, the source the JWT's
-- app_metadata comes from. The hosted data is already clean (checked
-- 2026-09-27), so the trigger doesn't fail on existing rows.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- PROVIDERS: the owner can't be an admin
-- ---------------------------------------------------------------------------

-- Security definer: signed-in users can't read auth.users, but the check has
-- to. It reads one field of one row and returns nothing.
create or replace function public.providers_owner_not_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users
             where id = new.owner_id and coalesce(raw_app_meta_data->>'role', '') = 'admin') then
    raise exception 'An admin login can''t own a business. Use a separate login for the provider.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.providers_owner_not_admin() is
  'Trigger function: a provider''s owner can''t be an admin login.';

create trigger providers_owner_not_admin
  before insert or update of owner_id on public.providers
  for each row execute function public.providers_owner_not_admin();
