-- Removes lokl's objects from the OLD Supabase project (the one shared with the blog).
-- Run once in that project's SQL Editor, after lokl has moved to its own project.
-- NEVER run it against lokl's own project: it would delete lokl. It refuses to
-- run unless the blog's posts table exists, which only the old project has.
-- One-off: kept for the record, not part of any workflow.
--
-- Removes: public.providers (and its policies, trigger and data),
--          public.is_admin(), public.set_updated_at(),
--          lokl's row in the CLI migration history,
--          the admin role on your login.
-- Touches no blog table, function, policy or login.
--
-- All-or-nothing: everything runs in one DO block, so if any check fails,
-- nothing is changed.
--
-- BEFORE RUNNING: replace YOUR_EMAIL below with your login's email.

do $$
declare
  v_admin_email constant text := 'YOUR_EMAIL';
  v_count int;
begin
  -- 0. Only the old, shared project has the blog's tables. Stop anywhere else.
  if to_regclass('public.posts') is null then
    raise exception 'Stopped: public.posts not found, so this is not the old shared project. Nothing was changed.';
  end if;

  if v_admin_email = 'YOUR_EMAIL' then
    raise exception 'Edit the script: set v_admin_email to your login''s email first.';
  end if;

  -- 1. Nothing outside lokl may depend on the two functions. Postgres tracks
  --    policies, triggers and defaults (checked by the drops below); function
  --    bodies are not tracked, so check those by name here.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.proname not in ('is_admin', 'set_updated_at')
    and (p.prosrc ilike '%is_admin%' or p.prosrc ilike '%set_updated_at%');
  if v_count > 0 then
    raise exception 'Stopped: % other function(s) mention is_admin or set_updated_at. Nothing was changed.', v_count;
  end if;

  -- 2. Nothing may reference providers by foreign key, other than itself.
  select count(*) into v_count
  from pg_constraint
  where contype = 'f'
    and confrelid = 'public.providers'::regclass
    and conrelid <> 'public.providers'::regclass;
  if v_count > 0 then
    raise exception 'Stopped: % foreign key(s) point at providers. Nothing was changed.', v_count;
  end if;

  -- 3. Drop lokl's table. Its policies and trigger go with it. RESTRICT (the
  --    default) refuses if anything else depends on it.
  drop table public.providers restrict;

  -- 4. Drop the helpers. RESTRICT refuses if any remaining policy, trigger or
  --    default still uses them, i.e. if the blog does.
  drop function public.is_admin() restrict;
  drop function public.set_updated_at() restrict;

  -- 5. Forget lokl's migration in the CLI history.
  delete from supabase_migrations.schema_migrations where version = '20260927000000';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Stopped: expected 1 migration-history row, found %. Nothing was changed.', v_count;
  end if;

  -- 6. Remove the admin role from your login only.
  update auth.users
  set raw_app_meta_data = raw_app_meta_data - 'role'
  where email = v_admin_email
    and raw_app_meta_data ->> 'role' = 'admin';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Stopped: expected to remove the admin role from 1 login (%), matched %. Nothing was changed.', v_admin_email, v_count;
  end if;

  raise notice 'lokl objects removed.';
end
$$;

-- Check (read-only). Every count should be 0.
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'providers')              as providers_table,
  (select count(*) from pg_proc where proname in ('is_admin', 'set_updated_at')
     and pronamespace = 'public'::regnamespace)                                                         as lokl_functions,
  (select count(*) from supabase_migrations.schema_migrations where version = '20260927000000')         as lokl_migration_rows,
  (select count(*) from auth.users where raw_app_meta_data ->> 'role' = 'admin')                         as admin_logins;
