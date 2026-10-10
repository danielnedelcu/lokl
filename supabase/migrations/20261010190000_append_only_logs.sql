-- Append-only logs (docs/TODO.md, Hardening; decided 2026-10-10).
--
-- lokl's logs and histories record what happened, so once written they stay
-- as written, for everyone: visitors, signed-in users, the server key and the
-- database owner alike. Grants already keep the API roles from changing
-- most of them; these triggers make it hold for the server too, so a bug in
-- a server route (or a hand-typed query) can't rewrite history.
--
--   1. The six logs (append_only_guard): rows are added, never changed or
--      deleted. The one exception: a reference whose target is deleted (a
--      login, a guide photo, an area, a category) is cleared to null by its
--      `on delete set null` key, so deleting those still works.
--   2. The email outboxes (outbox_guard): the sender updates the delivery
--      columns as it works; which email it is, and to whom, never changes,
--      and rows are never deleted.
--   3. Bookings and their money (refuse_delete): never deleted; a booking is
--      cancelled instead.
--
-- Every table also refuses TRUNCATE (no API role holds it since
-- explicit_api_grants; this covers the owner too).
--
-- The guards are ordinary triggers, so local test clean-up that runs with
-- session_replication_role = replica (which only the database owner can set)
-- still works. Switching a guard off also needs the owner, and
-- schema:compare reports a guard left switched off on hosted.
--
-- Anonymising a log (someone asks lokl to remove their personal details):
-- a migration per request, by row id only, never naming the person, with
-- the guard switched off and back on inside it. A migration is one
-- transaction, so a failure part-way never leaves the guard off; the last
-- statement fails the migration if any guard is off.
--
--   alter table public.admin_actions disable trigger admin_actions_append_only;
--   update public.admin_actions set reason = '[removed on request]' where id in ('…');
--   alter table public.admin_actions enable trigger admin_actions_append_only;
--   select public.assert_log_guards_on();
--
-- The outboxes' delivery columns (to_address, last_error) can be cleared
-- without switching anything off.

-- ---------------------------------------------------------------------------
-- 1. THE SIX LOGS
-- ---------------------------------------------------------------------------

create function public.append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  if tg_op = 'UPDATE' then
    -- Only the columns named in the trigger's arguments may change, and only
    -- to null (an `on delete set null` key whose target was deleted).
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- Generated columns are left out: they're filled in after BEFORE
    -- triggers, so here they always look changed (to null).
    for v_key in
      select a.attname from pg_catalog.pg_attribute a
      where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    loop
      if v_new -> v_key is distinct from v_old -> v_key
         -- tg_argv is null, not empty, when there are no arguments.
         and not (coalesce(v_key = any (tg_argv), false) and v_new -> v_key = 'null'::jsonb) then
        raise exception '% is a record of what happened: rows can''t be changed or deleted.', tg_table_name
          using errcode = 'check_violation';
      end if;
    end loop;
    return new;
  end if;
  raise exception '% is a record of what happened: rows can''t be changed or deleted.', tg_table_name
    using errcode = 'check_violation';
end;
$$;

comment on function public.append_only_guard() is
  'Trigger: refuses updates, deletes and truncates on a log. An update may only clear the columns named in the trigger''s arguments to null (their `on delete set null` keys). Fires for every role; no role calls it directly.';

-- Updates and deletes (row level); the arguments are the columns an
-- `on delete set null` key may clear.
create trigger admin_actions_append_only
  before update or delete on public.admin_actions
  for each row execute function public.append_only_guard('admin_id');
create trigger booking_events_append_only
  before update or delete on public.booking_events
  for each row execute function public.append_only_guard();
create trigger commission_rate_changes_append_only
  before update or delete on public.commission_rate_changes
  for each row execute function public.append_only_guard('changed_by');
create trigger guide_versions_append_only
  before update or delete on public.guide_versions
  for each row execute function public.append_only_guard('published_by', 'cover_photo_id', 'area_id', 'category_id');
create trigger job_runs_append_only
  before update or delete on public.job_runs
  for each row execute function public.append_only_guard();
-- booking_reports already refuses updates (booking_reports_final, whose
-- message the report route shows); this adds deletes.
create trigger booking_reports_append_only
  before delete on public.booking_reports
  for each row execute function public.append_only_guard();

-- Truncate (statement level).
create trigger admin_actions_append_only_truncate
  before truncate on public.admin_actions
  for each statement execute function public.append_only_guard();
create trigger booking_events_append_only_truncate
  before truncate on public.booking_events
  for each statement execute function public.append_only_guard();
create trigger commission_rate_changes_append_only_truncate
  before truncate on public.commission_rate_changes
  for each statement execute function public.append_only_guard();
create trigger guide_versions_append_only_truncate
  before truncate on public.guide_versions
  for each statement execute function public.append_only_guard();
create trigger job_runs_append_only_truncate
  before truncate on public.job_runs
  for each statement execute function public.append_only_guard();
create trigger booking_reports_append_only_truncate
  before truncate on public.booking_reports
  for each statement execute function public.append_only_guard();

-- ---------------------------------------------------------------------------
-- 2. THE EMAIL OUTBOXES
-- ---------------------------------------------------------------------------

create function public.outbox_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- What the sender writes as it works (runOutbox in bookingEmails.ts, and
  -- an admin's "try again" in adminBookings.ts).
  c_delivery constant text[] := array['status', 'attempts', 'next_attempt_at', 'locked_at', 'sent_at',
                                      'to_address', 'resend_id', 'last_error', 'skip_reason'];
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- Generated columns are left out: they're filled in after BEFORE
    -- triggers, so here they always look changed (to null).
    for v_key in
      select a.attname from pg_catalog.pg_attribute a
      where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    loop
      if v_new -> v_key is distinct from v_old -> v_key and not (v_key = any (c_delivery)) then
        raise exception '% records which email was sent to whom: only its delivery details can change (not %).', tg_table_name, v_key
          using errcode = 'check_violation';
      end if;
    end loop;
    return new;
  end if;
  raise exception '% records which email was sent to whom: rows can''t be deleted.', tg_table_name
    using errcode = 'check_violation';
end;
$$;

comment on function public.outbox_guard() is
  'Trigger: on an email outbox, only the delivery columns (status, attempts, next_attempt_at, locked_at, sent_at, to_address, resend_id, last_error, skip_reason) may change; deletes and truncates are refused. Fires for every role; no role calls it directly.';

create trigger booking_emails_outbox_guard
  before update or delete on public.booking_emails
  for each row execute function public.outbox_guard();
create trigger provider_emails_outbox_guard
  before update or delete on public.provider_emails
  for each row execute function public.outbox_guard();
create trigger booking_emails_outbox_guard_truncate
  before truncate on public.booking_emails
  for each statement execute function public.outbox_guard();
create trigger provider_emails_outbox_guard_truncate
  before truncate on public.provider_emails
  for each statement execute function public.outbox_guard();

-- ---------------------------------------------------------------------------
-- 3. BOOKINGS AND THEIR MONEY
-- ---------------------------------------------------------------------------

create function public.refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted: a booking is cancelled instead.', tg_table_name
    using errcode = 'check_violation';
end;
$$;

comment on function public.refuse_delete() is
  'Trigger: refuses deleting or truncating bookings and booking_finances (a booking is cancelled, never deleted). Fires for every role; no role calls it directly.';

create trigger bookings_refuse_delete
  before delete on public.bookings
  for each row execute function public.refuse_delete();
create trigger booking_finances_refuse_delete
  before delete on public.booking_finances
  for each row execute function public.refuse_delete();
create trigger bookings_refuse_delete_truncate
  before truncate on public.bookings
  for each statement execute function public.refuse_delete();
create trigger booking_finances_refuse_delete_truncate
  before truncate on public.booking_finances
  for each statement execute function public.refuse_delete();

-- ---------------------------------------------------------------------------
-- CHECKING THE GUARDS ARE ON
-- ---------------------------------------------------------------------------

create function public.assert_log_guards_on()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_off text;
begin
  select string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname) into v_off
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where p.proname in ('append_only_guard', 'outbox_guard', 'refuse_delete')
    and p.pronamespace = 'public'::regnamespace
    and t.tgenabled in ('D', 'R');
  if v_off is not null then
    raise exception 'These log guards are switched off: %. Switch them back on before this migration ends.', v_off
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.assert_log_guards_on() is
  'Fails if any append-only, outbox or refuse-delete guard is switched off (or set to fire only in replica mode). The last statement of any migration that switches one off. Only the database owner calls it.';

-- Trigger functions reach no API role (a trigger fires without EXECUTE);
-- the check is for migrations, run as the owner.
revoke execute on function public.append_only_guard() from public, anon, authenticated, service_role;
revoke execute on function public.outbox_guard() from public, anon, authenticated, service_role;
revoke execute on function public.refuse_delete() from public, anon, authenticated, service_role;
revoke execute on function public.assert_log_guards_on() from public, anon, authenticated, service_role;

select public.assert_log_guards_on();
