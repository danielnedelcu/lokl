-- Experience sessions (build step 5 of docs/design/categories-and-listings.md).
--
-- An Experience is booked into a dated session with a number of spots.
-- Bookings don't exist yet; when they do (product build step 4) they will
-- point at sessions with `on delete restrict`, so a session with bookings
-- can only be cancelled, never deleted, and capacity can't drop below the
-- spots already booked. Those rules come with the bookings table.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- ---------------------------------------------------------------------------
-- EXPERIENCE SESSIONS
-- ---------------------------------------------------------------------------

-- `on delete cascade` from listings, not `restrict` as the design doc first
-- said: a listing can only be deleted while it has never been live, so its
-- sessions can't have bookings, and a draft's sessions should go with it.
-- Bookings will protect sessions with their own `restrict` reference.
create table public.experience_sessions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  starts_at timestamptz not null,
  capacity smallint not null check (capacity between 1 and 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two scheduled sessions of one Experience can't start at the same time.
-- A cancelled session doesn't block its slot.
create unique index experience_sessions_listing_id_starts_at_key
  on public.experience_sessions (listing_id, starts_at)
  where status = 'scheduled';

create index experience_sessions_starts_at_idx on public.experience_sessions (starts_at);

comment on table public.experience_sessions is
  'Dated sessions of an Experience, each with a number of spots. Providers add and change future sessions (not while the listing is submitted or unpublished); a session that has started is kept as it is. Deleted with their listing, or by the provider before they start; once bookings exist, a session with bookings is cancelled instead.';
comment on column public.experience_sessions.starts_at is
  'When the session starts. Entered and shown in the listing city''s time zone (cities.timezone). Must be in the future and at most a year ahead when a provider adds or moves it.';
comment on column public.experience_sessions.capacity is
  'Spots in the session, 1 to 500. Spots left will be worked out from bookings.';
comment on column public.experience_sessions.status is
  'scheduled or cancelled. A cancelled session can''t be changed or scheduled again.';

create trigger experience_sessions_set_updated_at
  before update on public.experience_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- EXPERIENCE SESSIONS: kind, time and status rules
-- ---------------------------------------------------------------------------

-- Services are booked by request, so only Experiences have sessions.
-- listing_id can't be changed (column grants), so checking on insert is enough.
-- A clash names the date and time in the listing city's time zone, so a
-- provider adding a weekly series sees which week clashed. The editor saves
-- a series in one insert, so one clash saves none of it.
create or replace function public.experience_sessions_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if exists (select 1 from public.listings where id = new.listing_id and kind <> 'experience') then
    raise exception 'Only Experiences have sessions.' using errcode = 'check_violation';
  end if;

  if new.status = 'scheduled' and exists (
    select 1 from public.experience_sessions
    where listing_id = new.listing_id and starts_at = new.starts_at
      and status = 'scheduled' and id <> new.id
  ) then
    select c.timezone into v_timezone
    from public.listings l join public.cities c on c.id = l.city_id
    where l.id = new.listing_id;
    raise exception 'There''s already a session on %.',
      to_char(new.starts_at at time zone coalesce(v_timezone, 'UTC'), 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM')
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;
comment on function public.experience_sessions_check() is
  'Trigger function: sessions belong to Experiences only, and two scheduled sessions of one Experience can''t start at the same time.';

create trigger experience_sessions_check
  before insert or update of listing_id, starts_at, status on public.experience_sessions
  for each row execute function public.experience_sessions_check();

-- Provider rules. Like photos and travel areas, sessions follow the listing's
-- status: changeable in draft, rejected or live (the design allows session
-- edits on live listings), locked while submitted or unpublished. A session
-- that has started is history: it isn't moved, cancelled or deleted, and new
-- sessions are in the future. Cancelling is one-way, since customers will
-- have been told. The server and tests (service role) aren't limited, so
-- tests can create past sessions.
create or replace function public.experience_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing_id uuid := coalesce(new.listing_id, old.listing_id);
  v_status text;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  select status into v_status from public.listings where id = v_listing_id;
  if v_status in ('submitted', 'unpublished') then
    raise exception 'This listing''s sessions can''t be changed while it is %.', v_status
      using errcode = 'check_violation';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.starts_at <= now() then
      raise exception 'This session has already started, so it can''t be changed.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'cancelled' then
    raise exception 'A cancelled session can''t be changed. Add a new session instead.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.status <> 'scheduled' then
    raise exception 'New sessions start as scheduled.' using errcode = 'check_violation';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.status = 'scheduled' then
    if new.starts_at <= now() then
      raise exception 'Choose a time in the future.' using errcode = 'check_violation';
    end if;
    if new.starts_at > now() + interval '1 year' then
      raise exception 'Sessions can be added up to a year ahead.' using errcode = 'check_violation';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;
comment on function public.experience_sessions_guard() is
  'Trigger function: providers change sessions while a listing is a draft, rejected or live, never while submitted or unpublished; only future sessions are added, changed or deleted; new ones are scheduled, at most a year ahead; cancelling is final.';

create trigger experience_sessions_guard
  before insert or update or delete on public.experience_sessions
  for each row execute function public.experience_sessions_guard();

-- ---------------------------------------------------------------------------
-- EXPERIENCE SESSIONS: row access (RLS)
-- ---------------------------------------------------------------------------

alter table public.experience_sessions enable row level security;

create policy experience_sessions_read_public
  on public.experience_sessions for select to anon, authenticated
  using (
    status = 'scheduled'
    and starts_at > now()
    and exists (select 1 from public.listings l
                where l.id = listing_id and l.status = 'live'
                  and public.listing_parents_active(l.provider_id, l.category_id, l.city_id))
  );
comment on policy experience_sessions_read_public on public.experience_sessions is
  'Anyone can read the future, scheduled sessions of visible listings.';

create policy experience_sessions_read_own
  on public.experience_sessions for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy experience_sessions_read_own on public.experience_sessions is
  'Providers can read all sessions of their own listings, past and cancelled included.';

create policy experience_sessions_read_admin
  on public.experience_sessions for select to authenticated
  using ((select public.is_admin()));
comment on policy experience_sessions_read_admin on public.experience_sessions is
  'Admins can read all sessions.';

create policy experience_sessions_insert_own
  on public.experience_sessions for insert to authenticated
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy experience_sessions_insert_own on public.experience_sessions is
  'Providers can add sessions to their own listings.';

create policy experience_sessions_update_own
  on public.experience_sessions for update to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())))
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy experience_sessions_update_own on public.experience_sessions is
  'Providers can move, resize or cancel the sessions of their own listings.';

create policy experience_sessions_delete_own
  on public.experience_sessions for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.provider_id = (select public.current_provider_id())));
comment on policy experience_sessions_delete_own on public.experience_sessions is
  'Providers can delete sessions of their own listings that haven''t started.';

-- A session stays on its listing; a different listing means a new session.
revoke insert, update, delete on public.experience_sessions from anon;
revoke insert, update on public.experience_sessions from authenticated;
grant insert (listing_id, starts_at, capacity) on public.experience_sessions to authenticated;
grant update (starts_at, capacity, status) on public.experience_sessions to authenticated;
