-- Reviews and star ratings (docs/design/reviews.md, approved 2026-10-04).
--
-- 1. review_display_name(): the reviewer's name ("Sam T.") from the
--    free-text name on the booking.
-- 2. Who can review, and when: the booking's customer, once it's completed
--    and never cancelled, with no open no-show report, within 14 days of its
--    end. Editing and deleting: the same 14 days.
-- 3. reviews, review_replies, review_reports: tables, row rules, column
--    grants. Contact details refused in reviews and replies.
-- 4. listing_ratings, provider_ratings: each listing's and provider's count
--    and average of published reviews, kept up to date by a trigger.
-- 5. Emails, notifications and the admin log: new kinds; the review request
--    when a booking completes; the reminder (queue_review_reminders, for
--    the review-reminders job); the provider told of each new review.
-- 6. review_state(): a booking's review, for its customer's and provider's
--    pages. admin_reviews_page(), admin_moderate_review(): the moderation
--    queue and its actions, logged.
--
-- Delete behaviour: a review is deleted only by its customer, within the
-- window, and its reply and reports go with it. Otherwise nothing here is
-- deleted: a removal is a status. Ratings rows go with their listing
-- (only drafts are ever deleted, and drafts have no reviews).

-- ---------------------------------------------------------------------------
-- 1. The reviewer's name
-- ---------------------------------------------------------------------------

create or replace function public.review_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_words text[] := '{}';
  w text;
begin
  foreach w in array regexp_split_to_array(trim(coalesce(p_name, '')), '\s+') loop
    -- Letters (any alphabet), hyphens and apostrophes only; none at the ends.
    w := regexp_replace(w, '[^[:alpha:]''’-]', '', 'g');
    w := regexp_replace(w, '^[''’-]+|[''’-]+$', '', 'g');
    continue when w !~ '[[:alpha:]]';
    -- Tidy capitals only when typed all lower or all upper case; a capital
    -- after each hyphen too. Mixed case ("DeShawn") stays as typed.
    if w = lower(w) or w = upper(w) then
      select string_agg(upper(left(x, 1)) || lower(substr(x, 2)), '-' order by n) into w
      from unnest(string_to_array(w, '-')) with ordinality as t (x, n);
    end if;
    v_words := v_words || w;
  end loop;
  if cardinality(v_words) = 0 then
    return 'A lokl customer';
  end if;
  if cardinality(v_words) = 1 then
    return v_words[1];
  end if;
  return v_words[1] || ' ' || upper(left(v_words[cardinality(v_words)], 1)) || '.';
end;
$$;
comment on function public.review_display_name(text) is
  'The name a review shows, from the free-text name on the booking: the first word and the last word''s initial ("Sam T."), one word as is, capitals tidied when typed all lower or all upper case, letters, hyphens and apostrophes only; "A lokl customer" when nothing usable is left (docs/design/reviews.md).';
grant execute on function public.review_display_name(text) to anon, authenticated;

-- Visitors' rules ask provider_is_public() too (reviews, ratings). It
-- reveals nothing a visitor can't see on the profile page.
grant execute on function public.provider_is_public(uuid) to anon;

-- ---------------------------------------------------------------------------
-- 2. Who can review, and when
-- ---------------------------------------------------------------------------

-- The window: 14 days from the booking's end (not from when the pay-out job
-- marked it completed).
create or replace function public.review_window_open(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.ends_at is not null
      and now() < b.ends_at + interval '14 days');
$$;
comment on function public.review_window_open(uuid) is
  'True until 14 days after the booking''s end: the time to write, edit or delete its review.';
revoke execute on function public.review_window_open(uuid) from public, anon;
grant execute on function public.review_window_open(uuid) to authenticated;

-- Can the signed-in user review this booking now? Their own; completed (or
-- paid out) and never cancelled (so not a late cancel that was paid out,
-- nor a no-show refunded); ended, within the window; no open no-show report.
-- (Once only: the unique booking_id on reviews.)
create or replace function public.booking_can_be_reviewed(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and b.customer_id = (select auth.uid())
      and b.status in ('completed', 'paid_out')
      and b.cancelled_at is null
      and b.ends_at is not null and b.ends_at <= now()
      and now() < b.ends_at + interval '14 days'
      and (b.problem_reported_at is null or b.problem_resolution = 'paid_provider'));
$$;
comment on function public.booking_can_be_reviewed(uuid) is
  'True when the signed-in user may review this booking now: theirs, completed or paid out and never cancelled, ended under 14 days ago, no open no-show report.';
revoke execute on function public.booking_can_be_reviewed(uuid) from public, anon;
grant execute on function public.booking_can_be_reviewed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The tables
-- ---------------------------------------------------------------------------

-- The written review rules (docs/design/reviews.md; REVIEW_RULES in @repo/types).
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  -- Copied from the booking by reviews_fill; never sent.
  listing_id uuid not null references public.listings (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  reviewer_name text not null check (char_length(reviewer_name) between 1 and 160),
  booking_month date not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null
    constraint reviews_body_length check (char_length(trim(body)) between 20 and 2000)
    constraint reviews_body_no_contact_details check (not public.has_contact_details(body)),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  status text not null default 'published' check (status in ('published', 'removed')),
  removed_at timestamptz,
  removed_rule text check (removed_rule in ('abuse', 'private_information', 'off_topic', 'spam', 'sexual_or_illegal', 'conflict_of_interest')),
  removed_reason text check (char_length(removed_reason) <= 1000),
  constraint reviews_removed_has_rule check ((status = 'removed') = (removed_at is not null and removed_rule is not null))
);
comment on table public.reviews is
  'A customer''s review of a completed booking: one to five stars and their words, public at once. One per booking. Deleted only by its customer within 14 days of the booking''s end; removed (status) only by an admin, under the written rules.';
create index reviews_listing_idx on public.reviews (listing_id, created_at desc) where status = 'published';
create index reviews_provider_idx on public.reviews (provider_id, created_at desc);
create index reviews_customer_idx on public.reviews (customer_id);

create table public.review_replies (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete restrict,
  body text not null
    constraint review_replies_body_length check (char_length(trim(body)) between 1 and 1500)
    constraint review_replies_body_no_contact_details check (not public.has_contact_details(body)),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  status text not null default 'published' check (status in ('published', 'removed')),
  removed_at timestamptz,
  removed_rule text check (removed_rule in ('abuse', 'private_information', 'off_topic', 'spam', 'sexual_or_illegal', 'conflict_of_interest')),
  removed_reason text check (char_length(removed_reason) <= 1000),
  constraint review_replies_removed_has_rule check ((status = 'removed') = (removed_at is not null and removed_rule is not null))
);
comment on table public.review_replies is
  'The provider''s one public reply to a review. Editable and deletable by them at any time (deleting is also how a removed reply is written again); removed (status) only by an admin. Goes with its review.';
create index review_replies_provider_idx on public.review_replies (provider_id);

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  target text not null default 'review' check (target in ('review', 'reply')),
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule text not null check (rule in ('abuse', 'private_information', 'off_topic', 'spam', 'sexual_or_illegal', 'conflict_of_interest', 'something_else')),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text check (char_length(resolution_note) <= 1000),
  constraint review_reports_once unique (review_id, target, reporter_id),
  constraint review_reports_resolved check ((status = 'open') = (resolved_at is null))
);
comment on table public.review_reports is
  'A signed-in person''s report that a review or its reply breaks a written rule, for the admin''s queue. One per person per review and target. Goes with its review (or the reporter''s login).';
create index review_reports_open_idx on public.review_reports (review_id) where status = 'open';
create index review_reports_reporter_idx on public.review_reports (reporter_id);

-- Copy the booking's ids and the reviewer's name; a new review is published.
create or replace function public.reviews_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  select bk.listing_id, bk.provider_id, bk.customer_id, bk.customer_name,
         date_trunc('month', coalesce(bk.starts_at, bk.ends_at) at time zone c.timezone)::date as month
    into b
  from public.bookings bk
  join public.listings l on l.id = bk.listing_id
  join public.cities c on c.id = l.city_id
  where bk.id = new.booking_id;
  if not found then
    raise exception 'No such booking.' using errcode = 'foreign_key_violation';
  end if;
  new.listing_id := b.listing_id;
  new.provider_id := b.provider_id;
  new.customer_id := b.customer_id;
  new.reviewer_name := public.review_display_name(b.customer_name);
  new.booking_month := b.month;
  new.created_at := now();
  new.edited_at := null;
  new.status := 'published';
  new.removed_at := null;
  new.removed_rule := null;
  new.removed_reason := null;
  return new;
end;
$$;
create trigger reviews_fill before insert on public.reviews
  for each row execute function public.reviews_fill();

-- The copied columns never change; an edit to the stars or words is marked.
create or replace function public.reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.booking_id, new.listing_id, new.provider_id, new.customer_id, new.reviewer_name, new.booking_month, new.created_at)
     is distinct from (old.booking_id, old.listing_id, old.provider_id, old.customer_id, old.reviewer_name, old.booking_month, old.created_at) then
    raise exception 'A review''s booking, listing, provider, customer, name and dates can''t change.' using errcode = 'check_violation';
  end if;
  if (new.rating, new.body) is distinct from (old.rating, old.body) then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
create trigger reviews_guard before update on public.reviews
  for each row execute function public.reviews_guard();

create or replace function public.review_replies_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select r.provider_id into new.provider_id from public.reviews r where r.id = new.review_id;
    if new.provider_id is null then
      raise exception 'No such review.' using errcode = 'foreign_key_violation';
    end if;
    new.created_at := now();
    new.edited_at := null;
    new.status := 'published';
    new.removed_at := null;
    new.removed_rule := null;
    new.removed_reason := null;
  else
    if (new.review_id, new.provider_id, new.created_at) is distinct from (old.review_id, old.provider_id, old.created_at) then
      raise exception 'A reply''s review, provider and date can''t change.' using errcode = 'check_violation';
    end if;
    if new.body is distinct from old.body then
      new.edited_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger review_replies_fill before insert or update on public.review_replies
  for each row execute function public.review_replies_fill();

alter table public.reviews enable row level security;
alter table public.review_replies enable row level security;
alter table public.review_reports enable row level security;

revoke all on public.reviews, public.review_replies, public.review_reports from anon, authenticated;
-- Visitors: the public columns. Signed in: also the status and the rule of
-- a removal (only rows they may see in any status: their own, or admins).
-- Never to anyone through the API: the booking, the customer, the admin's
-- note (review_state and the admin functions return what each may see).
grant select (id, listing_id, provider_id, reviewer_name, booking_month, rating, body, created_at, edited_at)
  on public.reviews to anon;
grant select (id, listing_id, provider_id, reviewer_name, booking_month, rating, body, created_at, edited_at, status, removed_at, removed_rule)
  on public.reviews to authenticated;
grant insert (booking_id, rating, body), update (rating, body), delete on public.reviews to authenticated;

grant select (review_id, provider_id, body, created_at, edited_at) on public.review_replies to anon;
grant select (review_id, provider_id, body, created_at, edited_at, status, removed_at, removed_rule) on public.review_replies to authenticated;
grant insert (review_id, body), update (body), delete on public.review_replies to authenticated;

grant select (id, review_id, target, rule, note, created_at, status) on public.review_reports to authenticated;
grant insert (review_id, target, rule, note) on public.review_reports to authenticated;

-- The signed-in provider's own business, while it's active (replies). The
-- rules ask functions, not subqueries: a subquery in a rule needs the
-- caller to be able to read every column it touches.
create or replace function public.current_active_provider_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.providers where owner_id = (select auth.uid()) and status = 'active';
$$;
comment on function public.current_active_provider_id() is 'The signed-in user''s provider id while it''s active, else null.';
revoke execute on function public.current_active_provider_id() from public, anon;
grant execute on function public.current_active_provider_id() to authenticated;

-- Can the signed-in user report this review (or its reply)? Published, of a
-- public profile, not their own review; a reply must exist and be published.
create or replace function public.review_reportable(p_review_id uuid, p_target text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reviews r
    where r.id = p_review_id and r.status = 'published'
      and r.customer_id <> (select auth.uid())
      and public.provider_is_public(r.provider_id)
      and (p_target = 'review'
           or exists (select 1 from public.review_replies rp where rp.review_id = r.id and rp.status = 'published')));
$$;
comment on function public.review_reportable(uuid, text) is
  'True when the signed-in user may report this review or its reply: published, on a public profile, and not their own review.';
revoke execute on function public.review_reportable(uuid, text) from public, anon;
grant execute on function public.review_reportable(uuid, text) to authenticated;

-- reviews
-- provider_is_public: signed-in users can't read other providers' rows (the
-- public provider rule is for visitors), so the rules ask this function.
create policy reviews_read_public on public.reviews for select to anon, authenticated
  using (status = 'published' and public.provider_is_public(provider_id));
comment on policy reviews_read_public on public.reviews is
  'Anyone reads published reviews of a provider whose profile is public (including of listings no longer live). Removed ones aren''t public.';
create policy reviews_read_customer on public.reviews for select to authenticated
  using (customer_id = (select auth.uid()));
comment on policy reviews_read_customer on public.reviews is 'A customer reads their own reviews in any status.';
create policy reviews_read_provider on public.reviews for select to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy reviews_read_provider on public.reviews is 'A provider reads all reviews of their business, including removed ones.';
create policy reviews_read_admin on public.reviews for select to authenticated
  using (public.is_admin());
comment on policy reviews_read_admin on public.reviews is 'Admins read every review.';
create policy reviews_insert_customer on public.reviews for insert to authenticated
  with check (customer_id = (select auth.uid()) and public.booking_can_be_reviewed(booking_id));
comment on policy reviews_insert_customer on public.reviews is
  'A customer reviews their own booking once it qualifies: completed and never cancelled, ended under 14 days ago, no open no-show report.';
create policy reviews_update_customer on public.reviews for update to authenticated
  using (customer_id = (select auth.uid()) and status = 'published' and public.review_window_open(booking_id))
  with check (customer_id = (select auth.uid()) and status = 'published' and public.review_window_open(booking_id));
comment on policy reviews_update_customer on public.reviews is
  'A customer edits the stars and words of their own published review until 14 days after the booking''s end.';
create policy reviews_delete_customer on public.reviews for delete to authenticated
  using (customer_id = (select auth.uid()) and status = 'published' and public.review_window_open(booking_id));
comment on policy reviews_delete_customer on public.reviews is
  'A customer deletes their own published review until 14 days after the booking''s end (and may write again).';

-- review_replies
create policy review_replies_read_public on public.review_replies for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.reviews r where r.id = review_id));
comment on policy review_replies_read_public on public.review_replies is
  'Anyone reads a published reply to a review they can see.';
create policy review_replies_read_provider on public.review_replies for select to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy review_replies_read_provider on public.review_replies is 'A provider reads their own replies in any status.';
create policy review_replies_read_admin on public.review_replies for select to authenticated
  using (public.is_admin());
comment on policy review_replies_read_admin on public.review_replies is 'Admins read every reply.';
create policy review_replies_insert_provider on public.review_replies for insert to authenticated
  with check (
    provider_id = (select public.current_active_provider_id())
    and exists (select 1 from public.reviews r where r.id = review_id and r.status = 'published'));
comment on policy review_replies_insert_provider on public.review_replies is
  'An active provider replies once to a published review of their business.';
create policy review_replies_update_provider on public.review_replies for update to authenticated
  using (status = 'published' and provider_id = (select public.current_active_provider_id()))
  with check (status = 'published' and provider_id = (select public.current_active_provider_id()));
comment on policy review_replies_update_provider on public.review_replies is
  'An active provider edits their own published reply (a removed one is deleted and written again instead).';
create policy review_replies_delete_provider on public.review_replies for delete to authenticated
  using (provider_id = (select public.current_provider_id()));
comment on policy review_replies_delete_provider on public.review_replies is 'A provider deletes their own reply, in any status.';

-- review_reports
create policy review_reports_insert_signed_in on public.review_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and public.review_reportable(review_id, target));
comment on policy review_reports_insert_signed_in on public.review_reports is
  'Anyone signed in reports a published review, or its published reply, once each; not their own review.';
create policy review_reports_read_own on public.review_reports for select to authenticated
  using (reporter_id = (select auth.uid()));
comment on policy review_reports_read_own on public.review_reports is 'A person reads the reports they made.';
create policy review_reports_read_admin on public.review_reports for select to authenticated
  using (public.is_admin());
comment on policy review_reports_read_admin on public.review_reports is 'Admins read every report.';

-- ---------------------------------------------------------------------------
-- 4. Rating totals, kept by the database
-- ---------------------------------------------------------------------------

create table public.listing_ratings (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  review_count integer not null default 0 check (review_count >= 0),
  rating_total integer not null default 0 check (rating_total >= 0),
  rating_average numeric(2, 1) generated always as
    (case when review_count > 0 then round(rating_total::numeric / review_count, 1) end) stored,
  updated_at timestamptz not null default now()
);
comment on table public.listing_ratings is
  'Each listing''s published reviews: count, star total and average (rounded half up to one decimal). Kept by the reviews_recount trigger; never written from the apps.';

create table public.provider_ratings (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  review_count integer not null default 0 check (review_count >= 0),
  rating_total integer not null default 0 check (rating_total >= 0),
  rating_average numeric(2, 1) generated always as
    (case when review_count > 0 then round(rating_total::numeric / review_count, 1) end) stored,
  updated_at timestamptz not null default now()
);
comment on table public.provider_ratings is
  'Each provider''s published reviews across all their listings (including ones no longer live): count, star total and average. Kept by the reviews_recount trigger.';

alter table public.listing_ratings enable row level security;
alter table public.provider_ratings enable row level security;
revoke all on public.listing_ratings, public.provider_ratings from anon, authenticated;
grant select (listing_id, review_count, rating_average) on public.listing_ratings to anon, authenticated;
grant select (provider_id, review_count, rating_average) on public.provider_ratings to anon, authenticated;

create policy listing_ratings_read on public.listing_ratings for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));
comment on policy listing_ratings_read on public.listing_ratings is 'Readable as far as the listing is.';
create policy provider_ratings_read on public.provider_ratings for select to anon, authenticated
  using (public.provider_is_public(provider_id));
comment on policy provider_ratings_read on public.provider_ratings is 'Readable while the provider''s profile is public.';
create policy provider_ratings_read_own on public.provider_ratings for select to authenticated
  using (provider_id = (select public.current_provider_id()) or (select public.is_admin()));
comment on policy provider_ratings_read_own on public.provider_ratings is 'The provider reads their own rating, and admins every one.';

-- Recount a listing and a provider from their published reviews. The row
-- is locked first, so two reviews posted at once can't both count from a
-- stale total (each count runs after the other has committed).
create or replace function public.recount_ratings(p_listing_id uuid, p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.listing_ratings (listing_id) values (p_listing_id) on conflict do nothing;
  perform 1 from public.listing_ratings where listing_id = p_listing_id for update;
  update public.listing_ratings lr set
    review_count = t.n, rating_total = t.total, updated_at = now()
  from (select count(*)::integer as n, coalesce(sum(rating), 0)::integer as total
        from public.reviews where listing_id = p_listing_id and status = 'published') t
  where lr.listing_id = p_listing_id;

  insert into public.provider_ratings (provider_id) values (p_provider_id) on conflict do nothing;
  perform 1 from public.provider_ratings where provider_id = p_provider_id for update;
  update public.provider_ratings pr set
    review_count = t.n, rating_total = t.total, updated_at = now()
  from (select count(*)::integer as n, coalesce(sum(rating), 0)::integer as total
        from public.reviews where provider_id = p_provider_id and status = 'published') t
  where pr.provider_id = p_provider_id;
end;
$$;
revoke execute on function public.recount_ratings(uuid, uuid) from public, anon, authenticated;

create or replace function public.reviews_recount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recount_ratings(old.listing_id, old.provider_id);
  end if;
  if tg_op = 'INSERT' then
    perform public.recount_ratings(new.listing_id, new.provider_id);
  end if;
  return null;
end;
$$;
create trigger reviews_recount after insert or delete or update of rating, status on public.reviews
  for each row execute function public.reviews_recount();

-- ---------------------------------------------------------------------------
-- 5. Emails, notifications and the admin log
-- ---------------------------------------------------------------------------

alter table public.booking_emails drop constraint booking_emails_kind_check;
alter table public.booking_emails add constraint booking_emails_kind_check check (kind in (
  'customer_request_sent', 'customer_request_accepted', 'customer_request_declined', 'customer_request_expired',
  'customer_booking_confirmed', 'customer_booking_cancelled', 'customer_problem_received', 'customer_problem_refunded',
  'provider_new_request', 'provider_new_booking', 'provider_booking_cancelled', 'provider_request_unanswered',
  'provider_payout_sent', 'provider_problem_reported', 'provider_payout_problem', 'provider_problem_paid', 'provider_problem_refunded',
  'customer_review_request', 'customer_review_reminder', 'customer_review_removed', 'provider_new_review', 'provider_reply_removed'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'listing_approved', 'listing_rejected', 'listing_unpublished', 'listing_restored',
  'booking_requested', 'booking_confirmed', 'booking_cancelled', 'booking_problem_reported',
  'review_posted'));

alter table public.admin_actions drop constraint admin_actions_target_check;
alter table public.admin_actions add constraint admin_actions_target_check check (target in ('booking', 'provider', 'email', 'review'));
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check check (action in (
  'cancel_booking', 'release_payout', 'resolve_problem_paid', 'resolve_problem_refunded', 'retry_email',
  'suspend_provider', 'reinstate_provider', 'remove_profile_content',
  'remove_review', 'restore_review', 'remove_review_reply', 'restore_review_reply', 'dismiss_review_reports'));
-- The written rule a moderation action applied (reviews; profiles keep theirs on provider_emails).
alter table public.admin_actions add column rule text check (char_length(rule) <= 60);
comment on column public.admin_actions.rule is 'For review moderation: the written review rule the removal applied.';

-- The review request: when a booking completes (and qualifies), or when a
-- no-show report on a completed booking is resolved as "pay the provider".
create or replace function public.bookings_queue_review_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cancelled_at is null
     and new.status in ('completed', 'paid_out')
     and new.ends_at is not null and now() < new.ends_at + interval '14 days'
     and (new.problem_reported_at is null or new.problem_resolution = 'paid_provider')
     and ((old.status = 'confirmed' and new.status = 'completed')
          or (old.problem_resolution is null and new.problem_resolution = 'paid_provider'))
     and not exists (select 1 from public.reviews r where r.booking_id = new.id) then
    perform public.booking_emails_queue(new.id, array['customer_review_request']);
  end if;
  return null;
end;
$$;
create trigger bookings_queue_review_request after update of status, problem_resolution on public.bookings
  for each row execute function public.bookings_queue_review_request();

-- A new review: the provider's bell, and an email (once per booking).
create or replace function public.reviews_notify_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (provider_id, kind, listing_id, booking_id)
  values (new.provider_id, 'review_posted', new.listing_id, new.booking_id);
  perform public.booking_emails_queue(new.booking_id, array['provider_new_review']);
  return null;
end;
$$;
create trigger reviews_notify_provider after insert on public.reviews
  for each row execute function public.reviews_notify_provider();

-- The reminder, for the review-reminders job: once, from day 10 of the
-- window, to customers who could still review and haven't.
create or replace function public.queue_review_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select b.id from public.bookings b
    where b.status in ('completed', 'paid_out') and b.cancelled_at is null
      and b.ends_at is not null
      and b.ends_at + interval '10 days' <= p_now and p_now < b.ends_at + interval '14 days'
      and (b.problem_reported_at is null or b.problem_resolution = 'paid_provider')
      and not exists (select 1 from public.reviews r where r.booking_id = b.id)
      and not exists (select 1 from public.booking_emails e where e.booking_id = b.id and e.kind = 'customer_review_reminder')
  ), queued as (
    insert into public.booking_emails (booking_id, kind)
    select id, 'customer_review_reminder' from due
    on conflict (booking_id, kind) do nothing
    returning 1
  )
  select count(*) into v_count from queued;
  return v_count;
end;
$$;
comment on function public.queue_review_reminders(timestamptz) is
  'Queues the one review reminder for each booking 10 to 14 days after its end that could still be reviewed and hasn''t been. For the review-reminders job; returns how many.';
revoke execute on function public.queue_review_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_review_reminders(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. A booking's review, the moderation queue and its actions
-- ---------------------------------------------------------------------------

-- For the booking pages: the review and reply in any status (with the rule,
-- not the admin's note, if removed), whether the customer can write, edit
-- or delete, why not, the window's end, and the name the review shows.
-- The booking's own customer or provider only (or an admin).
create or replace function public.review_state(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  v_role text;
  r public.reviews;
  rp public.review_replies;
  v_open boolean;
  v_why text;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    return null;
  end if;
  if b.customer_id = (select auth.uid()) then
    v_role := 'customer';
  elsif exists (select 1 from public.providers p where p.id = b.provider_id and p.owner_id = (select auth.uid())) then
    v_role := 'provider';
  elsif public.is_admin() then
    v_role := 'admin';
  else
    return null;
  end if;

  select * into r from public.reviews where booking_id = b.id;
  if r.id is not null then
    select * into rp from public.review_replies where review_id = r.id;
  end if;
  v_open := b.ends_at is not null and now() < b.ends_at + interval '14 days';
  v_why := case
    when r.id is not null then 'reviewed'
    when b.cancelled_at is not null or b.status in ('cancelled', 'declined', 'expired') then 'cancelled'
    when b.ends_at is null or b.ends_at > now() then 'not_ended'
    when not v_open then 'window_closed'
    when b.problem_reported_at is not null and b.problem_resolution is distinct from 'paid_provider' then 'report_open'
    when b.status not in ('completed', 'paid_out') then 'not_completed'
  end;

  return jsonb_build_object(
    'role', v_role,
    'window_ends_at', b.ends_at + interval '14 days',
    'can_write', v_role = 'customer' and v_why is null,
    'why_not', v_why,
    'reviewer_name', coalesce(r.reviewer_name, public.review_display_name(b.customer_name)),
    'review', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at, 'edited_at', r.edited_at,
      'status', r.status, 'removed_rule', r.removed_rule,
      'can_change', v_role = 'customer' and v_open and r.status = 'published') end,
    'reply', case when rp.review_id is null then null else jsonb_build_object(
      'body', rp.body, 'created_at', rp.created_at, 'edited_at', rp.edited_at,
      'status', rp.status, 'removed_rule', rp.removed_rule) end);
end;
$$;
comment on function public.review_state(uuid) is
  'A booking''s review for its customer''s and provider''s pages: the review and reply in any status (the rule if removed, never the admin''s note), whether the customer can write, edit or delete, why not, the window''s end and the name it shows. Null for anyone else.';
revoke execute on function public.review_state(uuid) from public, anon;
grant execute on function public.review_state(uuid) to authenticated;

-- The admin's Reviews page: reviews with open reports (oldest report first),
-- or all reviews (newest first), with filters.
create or replace function public.admin_reviews_page(
  p_reported boolean default true,
  p_status text default null,
  p_provider_id uuid default null,
  p_rating integer default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_open_total bigint;
  v_rows jsonb;
begin
  -- Reads reporters' and customers' relation to the review: admins only.
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is not null and p_status not in ('published', 'removed') then
    raise exception 'Unknown status: %', p_status using errcode = 'invalid_parameter_value';
  end if;

  select count(distinct review_id) into v_open_total from public.review_reports where status = 'open';

  with picked as (
    select r.*,
           (select min(rr.created_at) from public.review_reports rr where rr.review_id = r.id and rr.status = 'open') as first_open
    from public.reviews r
    where (not coalesce(p_reported, true) or exists (select 1 from public.review_reports rr where rr.review_id = r.id and rr.status = 'open'))
      and (p_status is null or r.status = p_status)
      and (p_provider_id is null or r.provider_id = p_provider_id)
      and (p_rating is null or r.rating = p_rating)
  ), counted as (
    select count(*) as n from picked
  ), page as (
    select * from picked
    order by case when coalesce(p_reported, true) then first_open end asc nulls last, created_at desc
    limit v_size offset (v_page - 1) * v_size
  )
  select (select n from counted),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'rating', p.rating, 'body', p.body, 'reviewer_name', p.reviewer_name,
           'booking_month', p.booking_month, 'created_at', p.created_at, 'edited_at', p.edited_at,
           'status', p.status, 'removed_at', p.removed_at, 'removed_rule', p.removed_rule, 'removed_reason', p.removed_reason,
           'booking_id', p.booking_id,
           'listing', (select jsonb_build_object('id', l.id, 'title', l.title, 'slug', l.slug, 'kind', l.kind, 'status', l.status)
                       from public.listings l where l.id = p.listing_id),
           'provider', (select jsonb_build_object('id', pv.id, 'name', pv.display_name, 'slug', pv.slug)
                        from public.providers pv where pv.id = p.provider_id),
           'reply', (select jsonb_build_object('body', rp.body, 'created_at', rp.created_at, 'edited_at', rp.edited_at,
                                               'status', rp.status, 'removed_rule', rp.removed_rule, 'removed_reason', rp.removed_reason)
                     from public.review_replies rp where rp.review_id = p.id),
           'reports', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', rr.id, 'target', rr.target, 'rule', rr.rule, 'note', rr.note, 'created_at', rr.created_at,
                         'status', rr.status, 'resolution_note', rr.resolution_note,
                         'from', case
                           when exists (select 1 from public.providers pv where pv.id = p.provider_id and pv.owner_id = rr.reporter_id) then 'provider'
                           else 'someone_else' end)
                       order by rr.created_at)
                       from public.review_reports rr where rr.review_id = p.id), '[]'::jsonb),
           -- Earlier removals, for context.
           'provider_removals', (select count(*) from public.reviews x where x.provider_id = p.provider_id and x.status = 'removed' and x.id <> p.id)
                              + (select count(*) from public.review_replies y where y.provider_id = p.provider_id and y.status = 'removed'),
           'customer_removals', (select count(*) from public.reviews x where x.customer_id = p.customer_id and x.status = 'removed' and x.id <> p.id)
         ) order by case when coalesce(p_reported, true) then p.first_open end asc nulls last, p.created_at desc), '[]'::jsonb)
    into v_total, v_rows
  from page p;

  return jsonb_build_object('total', coalesce(v_total, 0), 'open_reports', v_open_total, 'rows', v_rows);
end;
$$;
comment on function public.admin_reviews_page(boolean, text, uuid, integer, integer, integer) is
  'The admin''s Reviews page: reviews with open reports (oldest report first) or all reviews (newest first), filtered by status, provider and stars, with the reply, the reports (from the provider or someone else) and earlier removals; and the number of reviews with open reports. Admins only.';
revoke execute on function public.admin_reviews_page(boolean, text, uuid, integer, integer, integer) from public, anon;
grant execute on function public.admin_reviews_page(boolean, text, uuid, integer, integer, integer) to authenticated;

-- Remove or restore a review or reply, or keep it (dismiss its open
-- reports): the change, the reports resolved, the admin log and the email,
-- in one transaction. Called by the website's server after checking the
-- admin; as a second line of defence, the id it passes must be an admin's.
create or replace function public.admin_moderate_review(
  p_review_id uuid,
  p_admin_id uuid,
  p_target text,
  p_action text,
  p_rule text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reviews;
  rp public.review_replies;
  v_reason text := trim(coalesce(p_reason, ''));
  v_log text;
  v_reports integer;
begin
  if not exists (select 1 from auth.users where id = p_admin_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Only an admin can moderate reviews.' using errcode = 'insufficient_privilege';
  end if;
  if p_target not in ('review', 'reply') or p_action not in ('remove', 'restore', 'keep') then
    raise exception 'Unknown moderation: % %.', p_action, p_target using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = 'check_violation';
  end if;
  if p_action = 'remove' and (p_rule is null or p_rule not in ('abuse', 'private_information', 'off_topic', 'spam', 'sexual_or_illegal', 'conflict_of_interest')) then
    raise exception 'Choose the review rule it breaks.' using errcode = 'check_violation';
  end if;

  select * into r from public.reviews where id = p_review_id for update;
  if not found then
    raise exception 'No such review.' using errcode = 'no_data_found';
  end if;
  if p_target = 'reply' then
    select * into rp from public.review_replies where review_id = p_review_id for update;
    if not found then
      raise exception 'This review has no reply.' using errcode = 'no_data_found';
    end if;
  end if;

  if p_action = 'remove' then
    if p_target = 'review' then
      if r.status = 'removed' then raise exception 'This review is already removed.' using errcode = 'check_violation'; end if;
      update public.reviews set status = 'removed', removed_at = now(), removed_rule = p_rule, removed_reason = v_reason where id = r.id;
      perform public.booking_emails_queue(r.booking_id, array['customer_review_removed']);
      v_log := 'remove_review';
    else
      if rp.status = 'removed' then raise exception 'This reply is already removed.' using errcode = 'check_violation'; end if;
      update public.review_replies set status = 'removed', removed_at = now(), removed_rule = p_rule, removed_reason = v_reason where review_id = r.id;
      perform public.booking_emails_queue(r.booking_id, array['provider_reply_removed']);
      v_log := 'remove_review_reply';
    end if;
    update public.review_reports set status = 'upheld', resolved_at = now(), resolved_by = p_admin_id, resolution_note = v_reason
    where review_id = r.id and target = p_target and status = 'open';
  elsif p_action = 'restore' then
    if p_target = 'review' then
      if r.status = 'published' then raise exception 'This review isn''t removed.' using errcode = 'check_violation'; end if;
      update public.reviews set status = 'published', removed_at = null, removed_rule = null, removed_reason = null where id = r.id;
      v_log := 'restore_review';
    else
      if rp.status = 'published' then raise exception 'This reply isn''t removed.' using errcode = 'check_violation'; end if;
      update public.review_replies set status = 'published', removed_at = null, removed_rule = null, removed_reason = null where review_id = r.id;
      v_log := 'restore_review_reply';
    end if;
  else
    update public.review_reports set status = 'dismissed', resolved_at = now(), resolved_by = p_admin_id, resolution_note = v_reason
    where review_id = r.id and target = p_target and status = 'open';
    get diagnostics v_reports = row_count;
    if v_reports = 0 then
      raise exception 'There are no open reports on this % to dismiss.', p_target using errcode = 'check_violation';
    end if;
    v_log := 'dismiss_review_reports';
  end if;

  insert into public.admin_actions (admin_id, target, target_id, action, reason, rule)
  values (p_admin_id, 'review', r.id, v_log, v_reason, case when p_action = 'remove' then p_rule end);
end;
$$;
comment on function public.admin_moderate_review(uuid, uuid, text, text, text, text) is
  'Removes or restores a review or its reply under a written rule, or keeps it (dismissing its open reports), with the reports resolved, the admin log and the author''s email in one transaction. The website''s server only, after checking the admin.';
revoke execute on function public.admin_moderate_review(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_moderate_review(uuid, uuid, text, text, text, text) to service_role;
