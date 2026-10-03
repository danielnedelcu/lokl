-- Provider account emails: "Your lokl account is paused" when lokl suspends
-- a provider, "...is active again" when it reinstates them, each with an
-- optional message from lokl (decided 2026-10-03).
--
-- 1. provider_emails: an outbox like booking_emails, but for the provider's
--    account rather than a booking. One row per admin action, so
--    suspending twice can't send twice. The website's sender sends it with
--    the row id as Resend's idempotency key and records the outcome.
-- 2. admin_set_provider_status(): suspends or reinstates a provider, logs
--    the admin action with its internal reason, and queues the email with
--    the optional message, all in one transaction. The internal reason
--    stays in admin_actions; only the message goes in the email.
--
-- Server only: provider_emails is read by admins and written only through
-- the function, which only the service role can call. Rows are never
-- deleted.

alter table public.admin_actions
  add column message text check (char_length(message) <= 1000);
comment on column public.admin_actions.message is
  'For suspending or reinstating a provider: the optional message lokl added to the provider''s email. (The reason is internal and never sent.)';

create table public.provider_emails (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete restrict,
  admin_action_id uuid not null unique references public.admin_actions (id) on delete restrict,
  kind text not null check (kind in ('provider_account_paused', 'provider_account_active')),
  message text check (char_length(message) <= 1000),
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
  constraint provider_emails_sent_has_time check (status <> 'sent' or sent_at is not null)
);
comment on table public.provider_emails is
  'Emails about a provider''s account (paused, active again) to send, and what happened to each. One per admin action. Queued by admin_set_provider_status(); sent by the website''s server. Server only; admins can read. Never deleted.';
comment on column public.provider_emails.message is 'lokl''s optional message, included in the email only if written.';
create index provider_emails_due_idx on public.provider_emails (next_attempt_at) where status in ('pending', 'sending');

alter table public.provider_emails enable row level security;
revoke all on public.provider_emails from anon, authenticated;
grant select on public.provider_emails to authenticated;
create policy provider_emails_read_admin on public.provider_emails for select to authenticated
  using ((select public.is_admin()));
comment on policy provider_emails_read_admin on public.provider_emails is
  'Admins can read provider account emails and their outcomes. Nobody else can read or write them; the server writes with the service role.';

-- Suspend or reinstate, log it, queue the email: one transaction, so the
-- three can't drift apart. Returns false when the provider already has that
-- status (nothing changes, nothing is sent).
create or replace function public.admin_set_provider_status(
  p_provider_id uuid, p_status text, p_admin_id uuid, p_reason text, p_message text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  -- Only the website's server calls this, after checking the admin. As a
  -- second line of defence, the id it passes must be an admin's.
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Only an admin can suspend or reinstate a provider.' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'A provider is active or suspended.' using errcode = 'check_violation';
  end if;
  update public.providers set status = p_status where id = p_provider_id and status <> p_status;
  if not found then
    if not exists (select 1 from public.providers where id = p_provider_id) then
      raise exception 'No such provider.' using errcode = 'no_data_found';
    end if;
    return false;
  end if;
  insert into public.admin_actions (admin_id, target, target_id, action, reason, message)
  values (p_admin_id, 'provider', p_provider_id,
          case when p_status = 'suspended' then 'suspend_provider' else 'reinstate_provider' end,
          p_reason, v_message)
  returning id into v_action;
  insert into public.provider_emails (provider_id, admin_action_id, kind, message)
  values (p_provider_id, v_action,
          case when p_status = 'suspended' then 'provider_account_paused' else 'provider_account_active' end,
          v_message);
  return true;
end;
$$;
comment on function public.admin_set_provider_status(uuid, text, uuid, text, text) is
  'Server only: suspends or reinstates a provider, logs the admin action with its internal reason, and queues the provider''s email with lokl''s optional message, in one transaction. Refuses an admin id that isn''t an admin''s.';
revoke execute on function public.admin_set_provider_status(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_provider_status(uuid, text, uuid, text, text) to service_role;
