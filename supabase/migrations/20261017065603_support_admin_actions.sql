-- Problem reports, the admin's side (docs/design/problem-reports.md, phase 3):
-- what an admin does to a report, each as one function the website's admin
-- routes call with the server key (requireAdminRequest has checked the
-- admin's token and the admin app's address). Each function makes its
-- change and logs it in admin_actions in one transaction, as review
-- moderation does (admin_moderate_review):
--
-- - admin_support_reply: lokl's reply on the thread, optionally moving the
--   report to Waiting on provider in the same step ("Reply and wait for
--   their answer"). The reply's notification and email come from
--   support_notify, as before.
-- - admin_support_move: "Move to…" and drag and drop. It names the column
--   the admin saw the card in, so a move made by someone else in between
--   is refused rather than overwritten.
-- - admin_support_note: a private note the provider never sees.
--
-- The history (support_report_events) records the admin as the actor,
-- through the report's status_changed_by columns. admin_actions logs ids
-- only, never what was written.

-- ---------------------------------------------------------------------------
-- ADMIN ACTIONS: reports as a target
-- ---------------------------------------------------------------------------

alter table public.admin_actions drop constraint admin_actions_target_check;
alter table public.admin_actions add constraint admin_actions_target_check
  check (target in ('booking', 'provider', 'email', 'review', 'support_report'));
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded', 'retry_email',
  'suspend_provider', 'reinstate_provider', 'remove_profile_content',
  'remove_review', 'restore_review', 'remove_review_reply', 'restore_review_reply', 'dismiss_review_reports',
  'support_reply', 'support_reply_wait', 'support_move', 'support_note'));
-- A report's actions need no reason: the reply, the note and the column
-- are the record (and they're in the report's own tables).
alter table public.admin_actions drop constraint admin_actions_reason;
alter table public.admin_actions add constraint admin_actions_reason check (
  action in ('retry_email', 'support_reply', 'support_reply_wait', 'support_move', 'support_note')
  or char_length(trim(reason)) >= 5);
comment on table public.admin_actions is
  'Every admin action on bookings, emails, providers, reviews and problem reports: who, what, when and why. Written by the website''s admin routes with the service role; read by admins. Never deleted.';

-- ---------------------------------------------------------------------------
-- SHARED CHECKS
-- ---------------------------------------------------------------------------

-- The admin named is an admin now, and the report exists (locked, so a
-- move and a reply at the same moment are taken one at a time).
create function public.support_admin_report(p_report_id uuid, p_admin_id uuid)
returns public.support_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports;
begin
  if not exists (select 1 from auth.users u where u.id = p_admin_id and u.raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_report from public.support_reports where id = p_report_id for update;
  if v_report.id is null then
    raise exception 'We couldn''t find that report.' using errcode = 'no_data_found';
  end if;
  return v_report;
end;
$$;
comment on function public.support_admin_report(uuid, uuid) is
  'For the admin''s report functions: refuses a login that isn''t an admin, and a report that doesn''t exist; returns the report, locked.';

-- The board's column names, for the refusals' words.
create function public.support_column_name(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'todo' then 'To do' when 'in_progress' then 'In progress'
    when 'waiting' then 'Waiting on provider' when 'done' then 'Done' else p_status end;
$$;
comment on function public.support_column_name(text) is 'A report status as the admin''s board names its column.';

-- ---------------------------------------------------------------------------
-- WHAT AN ADMIN DOES
-- ---------------------------------------------------------------------------

create function public.admin_support_reply(p_report_id uuid, p_admin_id uuid, p_body text, p_wait boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports := public.support_admin_report(p_report_id, p_admin_id);
begin
  -- The message's own check refuses an empty or over-long reply.
  insert into public.support_messages (report_id, author_kind, author_id, body)
  values (v_report.id, 'admin', p_admin_id, btrim(coalesce(p_body, '')));
  if coalesce(p_wait, false) and v_report.status <> 'waiting' then
    update public.support_reports
       set status = 'waiting', status_changed_by = 'admin', status_changed_by_id = p_admin_id
     where id = v_report.id;
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action)
  values (p_admin_id, 'support_report', v_report.id, case when coalesce(p_wait, false) then 'support_reply_wait' else 'support_reply' end);
  return (select status from public.support_reports where id = v_report.id);
end;
$$;
comment on function public.admin_support_reply(uuid, uuid, text, boolean) is
  'Server only (the website''s admin route): lokl''s reply on a report, as that admin; with p_wait, the report also moves to Waiting on provider. Logged in admin_actions. The provider''s bell and email follow (support_notify). Returns the report''s status.';

create function public.admin_support_move(p_report_id uuid, p_admin_id uuid, p_to text, p_from text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports := public.support_admin_report(p_report_id, p_admin_id);
begin
  if p_to is null or p_to not in ('todo', 'in_progress', 'waiting', 'done') then
    raise exception 'Choose a column: To do, In progress, Waiting on provider or Done.' using errcode = 'check_violation';
  end if;
  -- The column the admin saw it in: someone else may have moved it since.
  if p_from is not null and p_from <> v_report.status then
    raise exception 'Someone else moved it to % first. The board now shows where it is.', public.support_column_name(v_report.status)
      using errcode = 'check_violation';
  end if;
  if p_to = v_report.status then
    raise exception 'It''s already in %.', public.support_column_name(p_to) using errcode = 'check_violation';
  end if;
  update public.support_reports
     set status = p_to, status_changed_by = 'admin', status_changed_by_id = p_admin_id
   where id = v_report.id;
  insert into public.admin_actions (admin_id, target, target_id, action)
  values (p_admin_id, 'support_report', v_report.id, 'support_move');
  return p_to;
end;
$$;
comment on function public.admin_support_move(uuid, uuid, text, text) is
  'Server only (the website''s admin route): moves a report to another column as that admin, refusing it if the report isn''t in p_from any more (someone else moved it). Recorded in the report''s history with the admin as the actor, and logged in admin_actions.';

create function public.admin_support_note(p_report_id uuid, p_admin_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports := public.support_admin_report(p_report_id, p_admin_id);
  v_id uuid;
begin
  insert into public.support_notes (report_id, admin_id, body)
  values (v_report.id, p_admin_id, btrim(coalesce(p_body, '')))
  returning id into v_id;
  insert into public.admin_actions (admin_id, target, target_id, action)
  values (p_admin_id, 'support_report', v_report.id, 'support_note');
  return v_id;
end;
$$;
comment on function public.admin_support_note(uuid, uuid, text) is
  'Server only (the website''s admin route): an admin''s private note on a report, which the provider never sees. Logged in admin_actions.';

-- Only the server calls these (new functions have no PUBLIC EXECUTE;
-- function_execute_grants): stated here, so nothing reaches the API roles.
revoke execute on function public.support_admin_report(uuid, uuid), public.admin_support_reply(uuid, uuid, text, boolean),
  public.admin_support_move(uuid, uuid, text, text), public.admin_support_note(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_support_reply(uuid, uuid, text, boolean), public.admin_support_move(uuid, uuid, text, text),
  public.admin_support_note(uuid, uuid, text) to service_role;
-- support_column_name is only used inside these functions (as their owner).
revoke execute on function public.support_column_name(text) from public, anon, authenticated;
