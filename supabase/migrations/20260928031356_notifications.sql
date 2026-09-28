-- Provider notifications (docs/design/notifications.md).
--
-- A trigger on listings writes a notification when an admin action changes a
-- listing's status: approved, sent back, taken down, restored. Providers read
-- their own and mark them read; nothing else is written from the apps.
-- Supabase Realtime sends new rows to the provider live, filtered by the same
-- read rule.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------

-- provider_id restricts: providers are never deleted (they're suspended).
-- listing_id cascades: deleting a listing deletes its notifications, so the
-- bell never links to a listing that's gone. Only never-published listings
-- can be deleted, which among these kinds is only a sent-back Experience.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete restrict,
  kind text not null
    check (kind in ('listing_approved', 'listing_rejected', 'listing_unpublished', 'listing_restored')),
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_provider_id_created_at_idx on public.notifications (provider_id, created_at desc);
create index notifications_unread_idx on public.notifications (provider_id) where read_at is null;
create index notifications_listing_id_idx on public.notifications (listing_id);

comment on table public.notifications is
  'Things that happened to a provider''s listings because of an admin action. Written only by the listings_notify_status_change trigger. Providers read their own and mark them read. Deleted with their listing; otherwise kept (a cleanup of old read ones comes later).';
comment on column public.notifications.provider_id is
  'The recipient: the business that owns the listing.';
comment on column public.notifications.kind is
  'listing_approved (submitted -> live), listing_rejected (submitted -> rejected), listing_unpublished (live -> unpublished) or listing_restored (unpublished -> live). The sentence shown is built from this and the listing''s current title.';
comment on column public.notifications.read_at is
  'When the provider marked it read; null while unread. Once set it doesn''t change, and it can''t be cleared.';

-- ---------------------------------------------------------------------------
-- CREATED BY A TRIGGER ON LISTINGS
-- ---------------------------------------------------------------------------

-- These four transitions are admin-only (no provider route makes them), so
-- the trigger doesn't need to know who acted; provider transitions (publish,
-- submit, unlist) match none of them. Security definer, because it inserts
-- rows no signed-in user may insert; it writes nothing but the one row.
create or replace function public.listings_notify_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  v_kind := case
    when old.status = 'submitted' and new.status = 'live' then 'listing_approved'
    when old.status = 'submitted' and new.status = 'rejected' then 'listing_rejected'
    when old.status = 'live' and new.status = 'unpublished' then 'listing_unpublished'
    when old.status = 'unpublished' and new.status = 'live' then 'listing_restored'
  end;
  if v_kind is not null then
    insert into public.notifications (provider_id, kind, listing_id)
    values (new.provider_id, v_kind, new.id);
  end if;
  return null;
end;
$$;
comment on function public.listings_notify_status_change() is
  'Trigger function: writes a notification for the listing''s provider when an admin approves, sends back, takes down or restores it.';

create trigger listings_notify_status_change
  after update of status on public.listings
  for each row
  when (old.status is distinct from new.status)
  execute function public.listings_notify_status_change();

-- ---------------------------------------------------------------------------
-- MARKING READ
-- ---------------------------------------------------------------------------

-- The database sets the time, so a browser can't back-date or future-date
-- it, and marking an already-read notification again keeps the first time.
-- Clearing it (null) is left alone here and refused by the update policy.
create or replace function public.notifications_set_read_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.read_at is not null then
    new.read_at := coalesce(old.read_at, now());
  end if;
  return new;
end;
$$;
comment on function public.notifications_set_read_at() is
  'Trigger function: marking a notification read stores the database''s time, once.';

create trigger notifications_set_read_at
  before update of read_at on public.notifications
  for each row execute function public.notifications_set_read_at();

-- ---------------------------------------------------------------------------
-- ROW ACCESS (RLS)
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;

-- Realtime checks this same policy before sending a new row to a subscriber,
-- so it's also what keeps one provider from receiving another's.
create policy notifications_read_own
  on public.notifications for select to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy notifications_read_own on public.notifications is
  'Providers can read their own notifications. Realtime uses this rule too, so providers only receive their own live.';

create policy notifications_update_own
  on public.notifications for update to authenticated
  using (provider_id = (select public.current_provider_id()))
  with check (provider_id = (select public.current_provider_id()) and read_at is not null);
comment on policy notifications_update_own on public.notifications is
  'Providers can mark their own notifications read (not unread).';

-- No insert or delete policy, and no admin policy: notifications are written
-- by the trigger and read only by their provider.
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.notifications;
