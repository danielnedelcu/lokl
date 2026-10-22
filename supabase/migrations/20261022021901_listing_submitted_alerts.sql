-- The team is told when an Experience is waiting for review (decided
-- 2026-10-21): every active team member who can review listings (owners
-- and support alike: admin_set_listing_status lets either), in the bell
-- and by email, each time a listing is sent for review (a first submission
-- or a resubmission after changes).
--
-- The email goes at most once an hour per listing (the bell every time),
-- so several resubmissions in a row send the team one email.
--
-- 1. admin_notifications: a `listing_submitted` kind pointing at the
--    listing (deleted with it: a draft its provider deletes leaves no bell
--    row pointing nowhere).
-- 2. admin_emails: an `admin_listing_submitted` kind, naming the listing
--    without a key (an outbox row is never deleted, and the listing may
--    be; the sender skips it then, or once it's been reviewed).
-- 3. The trigger on listings that queues both, as the provider's write
--    happens.
--
-- Delete behaviour: admin_notifications rows are deleted with the listing
-- (as with the admin's login); admin_emails rows are never deleted
-- (outbox_guard).

-- ---------------------------------------------------------------------------
-- 1. THE BELL
-- ---------------------------------------------------------------------------

alter table public.admin_notifications add column listing_id uuid references public.listings (id) on delete cascade;
comment on column public.admin_notifications.listing_id is
  'For listing_submitted: the listing sent for review. Deleted with it.';
create index admin_notifications_listing on public.admin_notifications (listing_id) where listing_id is not null;

alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check check (kind in (
  'support_new', 'support_safety', 'support_reply', 'team_change', 'request_new', 'request_decided', 'limit_reached',
  'support_refund', 'listing_taken_down', 'settings_change', 'profile_hidden', 'profile_hidden_overdue', 'job_alert',
  'listing_submitted'));
alter table public.admin_notifications drop constraint admin_notifications_about_check;
alter table public.admin_notifications add constraint admin_notifications_about_check check (
  num_nonnulls(report_id, admin_action_id, admin_request_id, job_alert_id, listing_id) = 1
  and (kind in ('support_new', 'support_safety', 'support_reply')) = (report_id is not null)
  and (kind in ('team_change', 'limit_reached', 'support_refund', 'listing_taken_down', 'settings_change', 'profile_hidden', 'profile_hidden_overdue')) = (admin_action_id is not null)
  and (kind in ('request_new', 'request_decided')) = (admin_request_id is not null)
  and (kind = 'job_alert') = (job_alert_id is not null)
  and (kind = 'listing_submitted') = (listing_id is not null));
comment on table public.admin_notifications is
  'The admin bell, one row per team member''s login: problem reports and replies, requests, team changes, alerts for the owners, and (listing_submitted) an Experience waiting for review, for everyone who can review it. Each admin reads and marks read only their own. Ids only: published to Realtime. Deleted with the admin''s login, and a listing_submitted row with its listing.';

-- ---------------------------------------------------------------------------
-- 2. THE EMAIL
-- ---------------------------------------------------------------------------

alter table public.admin_emails add column listing_id uuid;
comment on column public.admin_emails.listing_id is
  'For admin_listing_submitted: the listing sent for review. No key: the outbox row is kept if the listing is deleted (the email is then skipped).';
alter table public.admin_emails drop constraint admin_emails_kind_check;
alter table public.admin_emails add constraint admin_emails_kind_check check (kind in (
  'admin_invite', 'admin_team_change', 'admin_request_new', 'admin_limit_reached', 'admin_support_refund',
  'admin_listing_taken_down', 'admin_settings_change', 'admin_profile_hidden', 'admin_profile_hidden_overdue', 'admin_job_alert',
  'admin_listing_submitted'));
alter table public.admin_emails drop constraint admin_emails_about_check;
alter table public.admin_emails add constraint admin_emails_about_check check (num_nonnulls(admin_action_id, job_alert_id, listing_id) = 1);
alter table public.admin_emails add constraint admin_emails_listing_kind check ((kind = 'admin_listing_submitted') = (listing_id is not null));
-- The trigger's once-an-hour check.
create index admin_emails_listing on public.admin_emails (listing_id, created_at) where listing_id is not null;

-- ---------------------------------------------------------------------------
-- 3. THE TRIGGER
-- ---------------------------------------------------------------------------

-- Security definer: the provider's own write sends a listing for review,
-- and they can't write either table.
create function public.listings_alert_team_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from 'submitted' or (tg_op = 'UPDATE' and old.status is not distinct from 'submitted') then
    return null;
  end if;
  insert into public.admin_notifications (recipient_id, kind, listing_id)
  select m.user_id, 'listing_submitted', new.id from public.admin_members m where m.status = 'active';
  -- The email at most once an hour per listing (decided 2026-10-21), so a
  -- provider resubmitting several times in a row doesn't fill the team's
  -- inboxes; the bell has every one.
  if not exists (
    select 1 from public.admin_emails e
    where e.kind = 'admin_listing_submitted' and e.listing_id = new.id and e.created_at > now() - interval '1 hour'
  ) then
    insert into public.admin_emails (kind, recipient_id, listing_id)
    select 'admin_listing_submitted', m.user_id, new.id from public.admin_members m where m.status = 'active';
  end if;
  return null;
end;
$$;
-- A trigger fires without its writer holding EXECUTE; no role calls it.
revoke execute on function public.listings_alert_team_submitted() from public, anon, authenticated, service_role;
comment on function public.listings_alert_team_submitted() is
  'Trigger: when a listing is sent for review (into submitted, from anything else), tells every active team member, owners and support, in the bell each time and by email at most once an hour per listing. Fires for every role; no role calls it directly.';

create trigger listings_alert_team_submitted
  after insert or update of status on public.listings
  for each row execute function public.listings_alert_team_submitted();
