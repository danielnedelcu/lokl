-- Problem reports, phase 1: data (docs/design/problem-reports.md, approved
-- 2026-10-17). Providers report a problem to lokl and follow it; the admin
-- works them on a board.
--
-- - support_reports: a provider's report; never deleted; only its status
--   (and the columns its triggers keep) ever change.
-- - support_messages, support_notes, support_report_events: the thread, the
--   admins' private notes and the status history; append-only.
-- - admin_notifications: the admin bell (new); notifications (the
--   provider's bell) gains support_reply.
-- - support_emails: the email outbox (only delivery details change).
-- - my_support_reports, admin_support_board, and admin_dashboard's counts.
--
-- Named support_*, not problem_*: review_reports and booking_reports exist,
-- and customers reporting problems come later.
--
-- Message text never reaches Realtime: only the notification rows (ids) are
-- published; an open report reloads its thread through these rules.

-- ---------------------------------------------------------------------------
-- 1. REPORTS
-- ---------------------------------------------------------------------------

create table public.support_reports (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null default public.current_provider_id() references public.providers (id) on delete restrict,
  reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
  category text not null check (category in ('booking', 'payments', 'listing', 'website', 'safety', 'other')),
  urgent boolean generated always as (category = 'safety') stored,
  description text not null check (char_length(btrim(description)) between 20 and 5000),
  listing_id uuid references public.listings (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete restrict,
  follows_report_id uuid references public.support_reports (id) on delete restrict,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'waiting', 'done')),
  -- Who moved it last: the provider (their report, a reply, "This is
  -- sorted"), an admin (the board), or the system.
  status_changed_by text not null default 'provider' check (status_changed_by in ('provider', 'admin', 'system')),
  status_changed_by_id uuid references auth.users (id) on delete set null,
  status_changed_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_message_from text not null default 'provider' check (last_message_from in ('provider', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'done') = (resolved_at is not null))
);

comment on table public.support_reports is
  'A problem a provider reported to lokl. Never deleted, and its details never change: only its status moves (on the admin''s board, by a reply, or by the provider''s "This is sorted"), with the columns its triggers keep.';
comment on column public.support_reports.urgent is 'A Safety report: first on the board, emailed to every admin at once, and only an admin closes it.';
comment on column public.support_reports.follows_report_id is 'The earlier report this follows on from: a reply to one resolved over 30 days ago starts a new report.';
comment on column public.support_reports.resolved_at is 'When it last moved to Done: a reply within 30 days of it reopens the report.';
comment on column public.support_reports.status is 'todo, in_progress, waiting (on the provider), done. Providers see Received, We''re looking into it, Waiting for your reply, Resolved.';

create index support_reports_provider on public.support_reports (provider_id, last_message_at desc);
create index support_reports_board on public.support_reports (status, urgent desc, last_message_at);
create index support_reports_listing on public.support_reports (listing_id) where listing_id is not null;
create index support_reports_booking on public.support_reports (booking_id) where booking_id is not null;

-- The limits' words, shared with the app (@repo/types), which adds the 911
-- line and the support address.
create function public.support_limit_message(p_what text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_what
    when 'reports' then 'You''ve sent a lot of reports today.'
    else 'You''ve sent a lot of messages today.' end;
$$;
comment on function public.support_limit_message(text) is 'The words of the rate limits'' refusals, which the app recognises and adds the 911 line and the support address to.';
-- The guards call it as the provider writing.
grant execute on function public.support_limit_message(text) to authenticated;

create function public.support_reports_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- A provider's own login (RLS has already checked the row is theirs);
  -- otherwise the server or a trigger, which may move a report freely.
  v_provider boolean := current_user in ('authenticated', 'anon');
  v_booking public.bookings;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Problem reports are never deleted.' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.provider_id is null then
      raise exception 'Only a business can report a problem.' using errcode = 'check_violation';
    end if;
    -- What it relates to: the provider's own listing and booking only (and
    -- a booking fills in its listing).
    if new.booking_id is not null then
      select * into v_booking from public.bookings where id = new.booking_id;
      if v_booking.id is null or v_booking.provider_id <> new.provider_id then
        raise exception 'That booking isn''t one of yours.' using errcode = 'check_violation';
      end if;
      if new.listing_id is null then
        new.listing_id := v_booking.listing_id;
      elsif new.listing_id <> v_booking.listing_id then
        raise exception 'That booking is for another of your listings.' using errcode = 'check_violation';
      end if;
    end if;
    if new.listing_id is not null
       and not exists (select 1 from public.listings where id = new.listing_id and provider_id = new.provider_id) then
      raise exception 'That listing isn''t one of yours.' using errcode = 'check_violation';
    end if;
    if new.follows_report_id is not null
       and not exists (select 1 from public.support_reports where id = new.follows_report_id and provider_id = new.provider_id) then
      raise exception 'That report isn''t one of yours.' using errcode = 'check_violation';
    end if;
    -- 10 a day (the last 24 hours); a Safety report is never refused.
    if new.category <> 'safety' and (
      select count(*) from public.support_reports r
       where r.provider_id = new.provider_id and r.category <> 'safety' and r.created_at > now() - interval '24 hours') >= 10 then
      raise exception '%', public.support_limit_message('reports') using errcode = 'check_violation';
    end if;
    if v_provider then
      new.reporter_id := auth.uid();
    end if;
    new.status := 'todo';
    new.status_changed_by := 'provider';
    new.status_changed_by_id := new.reporter_id;
    new.status_changed_at := now();
    new.resolved_at := null;
    new.last_message_at := now();
    new.last_message_from := 'provider';
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE: what was reported never changes.
  if new.provider_id is distinct from old.provider_id or new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null
     or new.category is distinct from old.category or new.description is distinct from old.description
     or new.listing_id is distinct from old.listing_id or new.booking_id is distinct from old.booking_id
     or new.follows_report_id is distinct from old.follows_report_id or new.created_at is distinct from old.created_at then
    raise exception 'A report''s details can''t be changed.' using errcode = 'check_violation';
  end if;
  if v_provider then
    -- The provider's own login only closes their report ("This is sorted"),
    -- and never a Safety one.
    if new.status is not distinct from old.status or new.status <> 'done' or old.status = 'done' then
      raise exception 'You can only mark your report as sorted.' using errcode = 'check_violation';
    end if;
    if old.category = 'safety' then
      raise exception 'Only lokl can close a safety report.' using errcode = 'check_violation';
    end if;
    if new.last_message_at is distinct from old.last_message_at or new.last_message_from is distinct from old.last_message_from then
      raise exception 'You can only mark your report as sorted.' using errcode = 'check_violation';
    end if;
    new.status_changed_by := 'provider';
    new.status_changed_by_id := auth.uid();
  end if;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.resolved_at := case when new.status = 'done' then now() end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.support_reports_guard() is
  'Trigger: a report is never deleted and its details never change. On insert: a business sends it, about its own listing and booking (a booking fills in its listing) and following its own report; at most 10 a day, Safety never refused; it starts in To do. On update: a provider''s own login only closes a report that isn''t Safety ("This is sorted"); the server and triggers move it freely. Keeps the status times.';

create trigger support_reports_guard
  before insert or update or delete on public.support_reports
  for each row execute function public.support_reports_guard();
create trigger support_reports_guard_truncate
  before truncate on public.support_reports
  for each statement execute function public.support_reports_guard();

-- ---------------------------------------------------------------------------
-- 2. THE THREAD, THE NOTES AND THE HISTORY (append-only)
-- ---------------------------------------------------------------------------

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.support_reports (id) on delete restrict,
  author_kind text not null default 'provider' check (author_kind in ('provider', 'admin')),
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
comment on table public.support_messages is
  'A report''s thread: messages from the provider and from lokl. Permanent: never edited or deleted (append_only_guard). The provider reads their own reports'' messages; admins read all. Never published to Realtime, and never in an email.';
create index support_messages_report on public.support_messages (report_id, created_at);

create table public.support_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.support_reports (id) on delete restrict,
  admin_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
comment on table public.support_notes is
  'Admins'' private notes on a report: the provider never sees them. Permanent (append_only_guard). Written by the server for an admin.';
create index support_notes_report on public.support_notes (report_id, created_at);

create table public.support_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.support_reports (id) on delete restrict,
  from_status text check (from_status in ('todo', 'in_progress', 'waiting', 'done')),
  to_status text not null check (to_status in ('todo', 'in_progress', 'waiting', 'done')),
  actor text not null check (actor in ('provider', 'admin', 'system')),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.support_report_events is 'Each status a report moved to, who moved it and when (from_status null: sent). Written only by a trigger; append-only.';
create index support_report_events_report on public.support_report_events (report_id, created_at);

create trigger support_messages_append_only before update or delete on public.support_messages
  for each row execute function public.append_only_guard('author_id');
create trigger support_messages_append_only_truncate before truncate on public.support_messages
  for each statement execute function public.append_only_guard();
create trigger support_notes_append_only before update or delete on public.support_notes
  for each row execute function public.append_only_guard('admin_id');
create trigger support_notes_append_only_truncate before truncate on public.support_notes
  for each statement execute function public.append_only_guard();
create trigger support_report_events_append_only before update or delete on public.support_report_events
  for each row execute function public.append_only_guard('actor_id');
create trigger support_report_events_append_only_truncate before truncate on public.support_report_events
  for each statement execute function public.append_only_guard();

-- The history, from the report's own changes.
create function public.support_reports_log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.support_report_events (report_id, from_status, to_status, actor, actor_id)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.status_changed_by, new.status_changed_by_id);
  end if;
  return null;
end;
$$;
comment on function public.support_reports_log_status() is 'Trigger: records each status a report moves to (and its sending) in support_report_events.';
create trigger support_reports_log_status
  after insert or update of status on public.support_reports
  for each row execute function public.support_reports_log_status();

-- A message: who wrote it, whether it may be added, and its effects.
create function public.support_messages_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_report public.support_reports;
begin
  select * into v_report from public.support_reports where id = new.report_id;
  if current_user in ('authenticated', 'anon') then
    -- A provider's own login writes as the provider (RLS checked the report is theirs).
    new.author_kind := 'provider';
    new.author_id := auth.uid();
    if v_report.status = 'done' and v_report.resolved_at < now() - interval '30 days' then
      raise exception 'This report was resolved over 30 days ago. Start a new report about this.' using errcode = 'check_violation';
    end if;
    -- 50 a day (the last 24 hours); never on a Safety report.
    if v_report.category <> 'safety' and (
      select count(*) from public.support_messages m join public.support_reports r on r.id = m.report_id
       where r.provider_id = v_report.provider_id and m.author_kind = 'provider' and m.created_at > now() - interval '24 hours') >= 50 then
      raise exception '%', public.support_limit_message('messages') using errcode = 'check_violation';
    end if;
  elsif new.author_id is null then
    raise exception 'Say who wrote the message.' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;
comment on function public.support_messages_check() is
  'Trigger: a provider''s own login always writes as the provider; not to a report resolved over 30 days ago; at most 50 a day, never limited on a Safety report. The server writes an admin''s, naming the admin.';
create trigger support_messages_check
  before insert on public.support_messages
  for each row execute function public.support_messages_check();

-- ---------------------------------------------------------------------------
-- 3. NOTIFICATIONS AND EMAILS
-- ---------------------------------------------------------------------------

-- The provider's bell: a reply from lokl. Notifications about a report have
-- no listing.
alter table public.notifications alter column listing_id drop not null;
alter table public.notifications add column support_report_id uuid references public.support_reports (id) on delete restrict;
comment on column public.notifications.support_report_id is 'The report lokl replied to (kind support_reply).';
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'listing_approved', 'listing_rejected', 'listing_unpublished', 'listing_restored',
  'booking_requested', 'booking_confirmed', 'booking_cancelled', 'booking_problem_reported',
  'review_posted', 'support_reply'));
alter table public.notifications add constraint notifications_about check (
  case when kind = 'support_reply' then support_report_id is not null else listing_id is not null end);
create index notifications_support_report on public.notifications (support_report_id) where support_report_id is not null;

-- The admin bell (new): one row per admin login per event.
create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('support_new', 'support_safety', 'support_reply')),
  report_id uuid not null references public.support_reports (id) on delete restrict,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table public.admin_notifications is
  'The admin bell: a new report (support_safety for a Safety one) or a provider''s reply, one row per admin login. Each admin reads and marks read only their own. Ids only: published to Realtime, so an open report reloads its thread. Deleted with the admin''s login.';
create index admin_notifications_recipient on public.admin_notifications (recipient_id, created_at desc);
create index admin_notifications_unread on public.admin_notifications (recipient_id) where read_at is null;
create index admin_notifications_report on public.admin_notifications (report_id);

create trigger admin_notifications_set_read_at
  before update of read_at on public.admin_notifications
  for each row execute function public.notifications_set_read_at();

-- The emails: to the provider about lokl's reply, to each admin about a new
-- report or a reply. Never the message or description: a link to read it.
create table public.support_emails (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.support_reports (id) on delete restrict,
  kind text not null check (kind in ('provider_support_reply', 'admin_support_new', 'admin_support_safety', 'admin_support_reply')),
  -- The provider (whose owner's address is used), or an admin login (no
  -- key: an outbox row is never deleted, and the login may be).
  provider_id uuid references public.providers (id) on delete restrict,
  admin_id uuid,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  to_address text check (char_length(to_address) <= 320),
  resend_id text,
  last_error text check (char_length(last_error) <= 500),
  skip_reason text check (char_length(skip_reason) <= 200),
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'provider_support_reply') = (provider_id is not null)),
  check ((kind <> 'provider_support_reply') = (admin_id is not null))
);
comment on table public.support_emails is
  'The problem reports'' email outbox: lokl''s reply to the provider, and a new report (urgent for Safety) or a reply to each admin. Never the message text. Only its delivery details change (outbox_guard); never deleted.';
create index support_emails_due on public.support_emails (next_attempt_at) where status in ('pending', 'failed');

create trigger support_emails_outbox_guard before update or delete on public.support_emails
  for each row execute function public.outbox_guard();
create trigger support_emails_outbox_guard_truncate before truncate on public.support_emails
  for each statement execute function public.outbox_guard();

-- Who's told what, from the report and its messages.
create function public.support_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.support_reports;
  v_kind text;
begin
  if tg_table_name = 'support_reports' then
    v_report := new;
    v_kind := case when new.category = 'safety' then 'support_safety' else 'support_new' end;
  else
    select * into v_report from public.support_reports where id = new.report_id;
    -- The thread's effects on the report: who wrote last; a provider's reply
    -- brings a report waiting on them back, and reopens one resolved in the
    -- last 30 days (an older one refuses the reply: support_messages_check).
    update public.support_reports
       set last_message_at = new.created_at,
           last_message_from = new.author_kind,
           status = case when new.author_kind = 'provider' and status = 'waiting' then 'in_progress'
                         when new.author_kind = 'provider' and status = 'done' then 'todo'
                         else status end,
           status_changed_by = case when new.author_kind = 'provider' and status in ('waiting', 'done') then 'provider' else status_changed_by end,
           status_changed_by_id = case when new.author_kind = 'provider' and status in ('waiting', 'done') then new.author_id else status_changed_by_id end
     where id = new.report_id;
    if new.author_kind = 'admin' then
      -- The provider's bell and email.
      insert into public.notifications (provider_id, kind, support_report_id) values (v_report.provider_id, 'support_reply', v_report.id);
      insert into public.support_emails (report_id, kind, provider_id) values (v_report.id, 'provider_support_reply', v_report.provider_id);
      return null;
    end if;
    v_kind := 'support_reply';
  end if;
  -- Every admin login: the bell, and an email.
  insert into public.admin_notifications (recipient_id, kind, report_id)
  select u.id, v_kind, v_report.id from auth.users u where u.raw_app_meta_data ->> 'role' = 'admin';
  insert into public.support_emails (report_id, kind, admin_id)
  select v_report.id, case v_kind when 'support_safety' then 'admin_support_safety' when 'support_new' then 'admin_support_new' else 'admin_support_reply' end, u.id
    from auth.users u where u.raw_app_meta_data ->> 'role' = 'admin';
  return null;
end;
$$;
comment on function public.support_notify() is
  'Trigger: a new report or a provider''s reply tells every admin (the admin bell and an email; urgent for Safety); lokl''s reply tells the provider (their bell and an email). A message also updates its report: who wrote last, and a provider''s reply brings back a report waiting on them or reopens one resolved in the last 30 days.';
create trigger support_reports_notify
  after insert on public.support_reports
  for each row execute function public.support_notify();
create trigger support_messages_notify
  after insert on public.support_messages
  for each row execute function public.support_notify();

-- Trigger functions run as triggers only: no role calls them.
revoke execute on function public.support_reports_guard(), public.support_reports_log_status(),
  public.support_messages_check(), public.support_notify() from public, anon, authenticated, service_role;

-- Realtime: the admin bell's rows (ids only), as the provider's are.
alter publication supabase_realtime add table public.admin_notifications;

-- ---------------------------------------------------------------------------
-- 4. WHO CAN DO WHAT
-- ---------------------------------------------------------------------------

alter table public.support_reports enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_notes enable row level security;
alter table public.support_report_events enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.support_emails enable row level security;

create policy support_reports_read_own on public.support_reports for select to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy support_reports_read_own on public.support_reports is 'Providers read their own business''s reports.';
create policy support_reports_read_admin on public.support_reports for select to authenticated
  using ((select public.is_admin()));
comment on policy support_reports_read_admin on public.support_reports is 'Admins read every report.';
create policy support_reports_insert_own on public.support_reports for insert to authenticated
  with check (provider_id = (select public.current_provider_id()));
comment on policy support_reports_insert_own on public.support_reports is 'Providers report problems as their own business (a suspended one too).';
create policy support_reports_update_own on public.support_reports for update to authenticated
  using (provider_id = (select public.current_provider_id()))
  with check (provider_id = (select public.current_provider_id()) and status = 'done');
comment on policy support_reports_update_own on public.support_reports is
  'Providers close their own report ("This is sorted"); the guard refuses anything else, and a Safety report.';

-- A report's children: through the reports the reader can see (their RLS).
create policy support_messages_read_own on public.support_messages for select to authenticated
  using (report_id in (select r.id from public.support_reports r where r.provider_id = (select public.current_provider_id())));
comment on policy support_messages_read_own on public.support_messages is 'Providers read the messages on their own reports.';
create policy support_messages_read_admin on public.support_messages for select to authenticated
  using ((select public.is_admin()));
comment on policy support_messages_read_admin on public.support_messages is 'Admins read every message.';
create policy support_messages_insert_own on public.support_messages for insert to authenticated
  with check (report_id in (select r.id from public.support_reports r where r.provider_id = (select public.current_provider_id())));
comment on policy support_messages_insert_own on public.support_messages is 'Providers reply on their own reports (as themselves: the trigger sets the author).';

create policy support_notes_read_admin on public.support_notes for select to authenticated
  using ((select public.is_admin()));
comment on policy support_notes_read_admin on public.support_notes is 'Only admins read notes: providers never see them.';

create policy support_report_events_read_own on public.support_report_events for select to authenticated
  using (report_id in (select r.id from public.support_reports r where r.provider_id = (select public.current_provider_id())));
comment on policy support_report_events_read_own on public.support_report_events is 'Providers read their own reports'' history.';
create policy support_report_events_read_admin on public.support_report_events for select to authenticated
  using ((select public.is_admin()));
comment on policy support_report_events_read_admin on public.support_report_events is 'Admins read every report''s history.';

create policy admin_notifications_read_own on public.admin_notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and (select public.is_admin()));
comment on policy admin_notifications_read_own on public.admin_notifications is 'Each admin reads their own bell.';
create policy admin_notifications_update_own on public.admin_notifications for update to authenticated
  using (recipient_id = (select auth.uid()) and (select public.is_admin()))
  with check (recipient_id = (select auth.uid()) and read_at is not null);
comment on policy admin_notifications_update_own on public.admin_notifications is 'Each admin marks their own as read (never unread).';

create policy support_emails_read_admin on public.support_emails for select to authenticated
  using ((select public.is_admin()));
comment on policy support_emails_read_admin on public.support_emails is 'Admins read the outbox (who was emailed, and how it went).';

-- Grants: exactly what each role uses (explicit_api_grants). Nothing in
-- these tables is deleted by anyone; the server writes the rest.
grant select on public.support_reports, public.support_messages, public.support_notes, public.support_report_events,
  public.admin_notifications, public.support_emails to authenticated;
grant insert (category, description, listing_id, booking_id, follows_report_id) on public.support_reports to authenticated;
grant update (status) on public.support_reports to authenticated;
grant insert (report_id, body) on public.support_messages to authenticated;
grant update (read_at) on public.admin_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE LISTS (paged in the database)
-- ---------------------------------------------------------------------------

create function public.my_support_reports(p_page integer default 1, p_page_size integer default 20)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- As the provider (their read rule): newest activity first, with how many
  -- wait for their reply.
  with mine as (
    select r.* from public.support_reports r where r.provider_id = (select public.current_provider_id())
  ), page as (
    select * from mine order by last_message_at desc, id
    limit least(greatest(coalesce(p_page_size, 20), 1), 100)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 20), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from mine),
    'waiting', (select count(*) from mine where status = 'waiting'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'category', p.category, 'urgent', p.urgent, 'excerpt', left(p.description, 140),
        'status', p.status, 'status_changed_at', p.status_changed_at, 'resolved_at', p.resolved_at,
        'last_message_at', p.last_message_at, 'last_message_from', p.last_message_from, 'created_at', p.created_at,
        'listing', (select jsonb_build_object('id', l.id, 'title', l.title) from public.listings l where l.id = p.listing_id),
        'booking', (select jsonb_build_object('id', b.id, 'starts_at', b.starts_at) from public.bookings b where b.id = p.booking_id))
      order by p.last_message_at desc, p.id) from page p), '[]'::jsonb));
$$;
comment on function public.my_support_reports(integer, integer) is
  'The signed-in provider''s reports, a page at a time (at most 100), newest activity first, with the total and how many wait for their reply. Runs with the caller''s read rules.';
grant execute on function public.my_support_reports(integer, integer) to authenticated;

create function public.admin_support_board(p_category text default null, p_urgent_only boolean default false,
  p_q text default null, p_done_days integer default 30, p_column text default null,
  p_page integer default 1, p_page_size integer default 50)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  -- The admin searches' words, escaped so % and _ match literally.
  v_patterns text[] := public.admin_search_patterns(p_q);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_columns jsonb := '{}'::jsonb;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if p_column is not null and p_column not in ('todo', 'in_progress', 'waiting', 'done') then
    raise exception 'Unknown column: %', p_column using errcode = 'invalid_parameter_value';
  end if;
  -- Every column (the board), or one column's page ("Show more").
  foreach v_status in array case when p_column is null then array['todo', 'in_progress', 'waiting', 'done'] else array[p_column] end loop
    v_columns := v_columns || jsonb_build_object(v_status, (
      with matched as (
        select r.*, p.display_name as provider_name
          from public.support_reports r join public.providers p on p.id = r.provider_id
         where r.status = v_status
           and (p_category is null or r.category = p_category)
           and (not coalesce(p_urgent_only, false) or r.urgent)
           -- Each word in the business's name or what happened.
           and not exists (select 1 from unnest(v_patterns) w where not (p.display_name ilike w or r.description ilike w))
           -- Done: the last p_done_days, or every one when it's null ("See all done").
           and (v_status <> 'done' or p_done_days is null or r.resolved_at > now() - make_interval(days => greatest(p_done_days, 1)))
      ), ordered as (
        select m.*, row_number() over (order by
          case when v_status in ('todo', 'in_progress') then m.urgent end desc,
          case when v_status = 'todo' then m.created_at end asc,
          case when v_status = 'in_progress' then m.last_message_at end asc,
          case when v_status = 'waiting' then m.status_changed_at end asc,
          case when v_status = 'done' then m.resolved_at end desc,
          m.id) as n
        from matched m
      )
      select jsonb_build_object(
        'total', (select count(*) from matched),
        'page', v_page,
        'page_size', v_size,
        'rows', coalesce((select jsonb_agg(jsonb_build_object(
            'id', o.id, 'category', o.category, 'urgent', o.urgent, 'excerpt', left(o.description, 140),
            'provider', jsonb_build_object('id', o.provider_id, 'name', o.provider_name),
            'status_changed_at', o.status_changed_at, 'last_message_at', o.last_message_at,
            'last_message_from', o.last_message_from, 'created_at', o.created_at, 'resolved_at', o.resolved_at) order by o.n)
          from ordered o where o.n > (v_page - 1) * v_size and o.n <= v_page * v_size), '[]'::jsonb))));
  end loop;
  return jsonb_build_object('columns', v_columns);
end;
$$;
comment on function public.admin_support_board(text, boolean, text, integer, text, integer, integer) is
  'Admins only: the board''s columns, each with its total and one page of cards (at most 100) in the board''s order (To do and In progress urgent first), filtered by category, urgency and the admin search''s words (admin_search_patterns: each word in the business name or what happened, matched literally); Done holds the last p_done_days, or all when null. One column''s later page with p_column and p_page ("Show more"), so a column never stops quietly. Runs with the admin''s read rules.';
grant execute on function public.admin_support_board(text, boolean, text, integer, text, integer, integer) to authenticated;

-- The dashboard's "Needs attention": open reports, and how many are urgent.
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := coalesce((select timezone from public.cities where slug = 'atlanta'), 'America/New_York');
  v_today date := (now() at time zone v_tz)::date;
  v_from30 date := v_today - 29;
  v_from90 date := v_today - 89;
  v_paid jsonb;
  v_attention jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;

  -- The money cards: the Bookings page's totals for "paid in the last 30 days".
  v_paid := public.admin_bookings_page(p_paid_from => v_from30, p_paid_to => v_today, p_page_size => 1, p_with_attention => true);
  v_attention := v_paid -> 'attention';

  return jsonb_build_object(
    'time_zone', v_tz,
    'today', v_today,
    'paid_from', v_from30,
    'active_since', v_from90,
    'gmv_cents', (v_paid -> 'totals' ->> 'charged_cents')::bigint - (v_paid -> 'totals' ->> 'refunded_cents')::bigint,
    'commission_cents', (v_paid -> 'totals' ->> 'commission_cents')::bigint,
    'bookings', (v_paid ->> 'total')::bigint,
    'active_providers', (public.admin_providers_page(p_paid_since => v_from90, p_page_size => 1) ->> 'total')::bigint,
    'listings_to_review', jsonb_build_object(
      'experience', (public.admin_listings_page(p_kind => 'experience', p_status => 'submitted', p_page_size => 1) ->> 'total')::bigint,
      'service', (public.admin_listings_page(p_kind => 'service', p_status => 'submitted', p_page_size => 1) ->> 'total')::bigint),
    'open_disputes', (select count(*) from public.booking_finances f where f.disputed_at is not null and f.dispute_closed_at is null),
    -- As the Bookings page's "Needs attention" heading counts: its groups,
    -- failed emails, and job runs with failures in the last 7 days.
    'bookings_attention',
      (select coalesce(sum(value::bigint), 0) from jsonb_each_text(coalesce(v_attention, '{}'::jsonb)))
      + (select count(*) from public.booking_emails e where e.status = 'failed')
      + (select count(*) from public.job_runs r where r.finished_at >= now() - interval '7 days' and (r.failed > 0 or r.error is not null)),
    -- As the Guides list's "Draft" tab counts them: every guide not live.
    'guide_drafts', (select count(*) from public.guides g where g.status <> 'published'),
    'providers_not_payable', (public.admin_providers_page(p_status => 'active', p_payout_setup => 'not_ready', p_page_size => 1) ->> 'total')::bigint,
    -- Problem reports not yet done, and how many of those are Safety.
    'open_reports', (select count(*) from public.support_reports r where r.status <> 'done'),
    'urgent_reports', (select count(*) from public.support_reports r where r.status <> 'done' and r.urgent)
  );
end;
$$;
comment on function public.admin_dashboard() is
  'Admins only: the admin dashboard''s numbers in one call. Money and provider numbers come from admin_bookings_page and admin_providers_page with the filters the dashboard links to (paid in the last 30 days, a paid booking in the last 90, by the Atlanta market''s calendar), so a number matches the page behind it. GMV is charged minus refunded; commission is before Stripe''s fees. Also the open problem reports and how many are urgent (Safety).';
