-- Step 4, part 7: booking emails.
--
-- An outbox. Every booking change that needs an email adds a row here, in
-- the same transaction as the change, through triggers, so no route,
-- webhook or job can forget one. The website's sender
-- (server/utils/bookingEmails.ts) sends pending rows through Resend and
-- records the outcome on the row, which is the log of what was sent.
--
-- - One row per booking and email kind (unique), so a retried action, a
--   repeated webhook or a job run twice can't queue a second email.
-- - The triggers only insert ids and the kind: nothing in them can fail on
--   its own and break the booking change.
-- - Server only: RLS on, read by admins (for part 8), no access for
--   anyone else. Rows are never deleted (bookings aren't either).

create table public.booking_emails (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  kind text not null check (kind in (
    'customer_request_sent', 'customer_request_accepted', 'customer_request_declined',
    'customer_request_expired', 'customer_booking_confirmed', 'customer_booking_cancelled',
    'customer_problem_received',
    'provider_new_request', 'provider_new_booking', 'provider_booking_cancelled',
    'provider_request_unanswered', 'provider_payout_sent', 'provider_problem_reported',
    'provider_payout_problem')),
  recipient text not null generated always as (split_part(kind, '_', 1)) stored,
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
  constraint booking_emails_once unique (booking_id, kind),
  constraint booking_emails_sent_has_time check (status <> 'sent' or sent_at is not null)
);
comment on table public.booking_emails is
  'Booking emails to send and what happened to each (the outbox and the log). Filled by triggers on bookings; sent by the website''s server. Server only; admins can read. Never deleted.';
comment on column public.booking_emails.kind is
  'Which email: customer_* go to the customer, provider_* to the provider (docs/design/booking-and-checkout.md, Emails).';
comment on column public.booking_emails.recipient is 'customer or provider, from the kind.';
comment on column public.booking_emails.to_address is 'Where it was sent, recorded when sent (or skipped).';
comment on column public.booking_emails.next_attempt_at is 'When the sender may try a pending email (later after each failure).';

create index booking_emails_due_idx on public.booking_emails (next_attempt_at) where status in ('pending', 'sending');

alter table public.booking_emails enable row level security;
revoke all on public.booking_emails from anon, authenticated;
grant select on public.booking_emails to authenticated;

create policy booking_emails_read_admin on public.booking_emails for select to authenticated
  using ((select public.is_admin()));
comment on policy booking_emails_read_admin on public.booking_emails is
  'Admins can read every booking email and its outcome (part 8). Nobody else can read or write them; the server writes with the service role.';

-- ---------------------------------------------------------------------------
-- QUEUEING
-- ---------------------------------------------------------------------------

create or replace function public.booking_emails_queue(p_booking_id uuid, p_kinds text[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.booking_emails (booking_id, kind)
  select p_booking_id, k from unnest(p_kinds) k
  on conflict (booking_id, kind) do nothing;
$$;
comment on function public.booking_emails_queue(uuid, text[]) is
  'Queues booking emails, once each (a repeat is ignored). Used by the bookings email trigger.';
revoke execute on function public.booking_emails_queue(uuid, text[]) from public, anon, authenticated;

-- Which emails a booking change sends (docs/design/booking-and-checkout.md,
-- Emails). Status changes, a no-show report, and a payout the provider's
-- account couldn't take.
create or replace function public.bookings_queue_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text[] := '{}';
begin
  if new.status is distinct from old.status then
    v := v || case
      when new.status = 'requested' then
        array['customer_request_sent', 'provider_new_request']
      when old.status = 'requested' and new.status = 'confirmed' then
        array['customer_request_accepted']
      when old.status = 'pending_payment' and new.status = 'confirmed' then
        array['customer_booking_confirmed', 'provider_new_booking']
      when old.status = 'requested' and new.status = 'declined' then
        array['customer_request_declined']
      -- No answer in time (the system): both hear. The card failing when
      -- the provider accepted: only the customer (the provider saw it).
      when old.status = 'requested' and new.status = 'expired' then
        case when new.status_changed_by = 'system'
          then array['customer_request_expired', 'provider_request_unanswered']
          else array['customer_request_expired'] end
      when new.status = 'cancelled' and old.status in ('requested', 'confirmed', 'completed') then
        case when new.cancelled_by = 'provider'
          then array['customer_booking_cancelled']
          else array['customer_booking_cancelled', 'provider_booking_cancelled'] end
      when new.status = 'paid_out' then
        array['provider_payout_sent']
      else '{}'::text[]
    end;
  end if;
  if old.problem_reported_at is null and new.problem_reported_at is not null then
    v := v || array['customer_problem_received', 'provider_problem_reported'];
  end if;
  if old.payout_hold is null and new.payout_hold in ('account_cannot_receive', 'transfer_failed') then
    v := v || array['provider_payout_problem'];
  end if;
  if cardinality(v) > 0 then
    perform public.booking_emails_queue(new.id, v);
  end if;
  return null;
end;
$$;
comment on function public.bookings_queue_emails() is
  'Trigger function: queues the booking emails a change calls for (status changes, a no-show report, a payout the provider''s account couldn''t take).';

create trigger bookings_queue_emails
  after update of status, problem_reported_at, payout_hold on public.bookings
  for each row execute function public.bookings_queue_emails();
