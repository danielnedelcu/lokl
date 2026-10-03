-- Server-side search, filters and pages for the admin's Bookings,
-- Experiences, Services and Providers tables (planned and approved
-- 2026-10-03). The pages used to load every row into the browser; now each
-- asks one function for one page of rows plus the total.
--
-- Access: every function first checks the caller is an admin (42501
-- otherwise), and that check is what guards them: they're security definer,
-- so row-level security doesn't apply inside. Run as the caller, every row
-- went through every read policy on bookings, listings, providers, cities
-- and categories (some with per-row subqueries): about 3,000 scans of those
-- tables per search, 90-200ms at 10,000 bookings. The providers function
-- also reads owners' emails from auth.users. pgTAP checks each function
-- refuses customers, providers and signed-out visitors. All are callable by
-- signed-in users only.
--
-- is_admin() is the right check inside security definer: it reads the
-- caller's sign-in claims (auth.jwt(), from the request), which stay the
-- caller's. current_user would not do: inside a security definer function
-- it's always the function's owner.
--
-- Search: the text is split into words (at most 8, each up to 100
-- characters); every word has to match one of the searched fields. Words are
-- escaped, so % and _ match themselves. Trigram indexes (pg_trgm) keep
-- "contains" searches on titles, names and emails fast.
--
-- Totals: exact for now ("total_exact": true). The shape lets a function
-- switch to an estimate later without the pages changing.
--
-- Delete behaviour: adds functions and indexes only.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

-- "Search anything": contains-searches on these use the trigram indexes.
create index if not exists bookings_customer_name_trgm on public.bookings using gin (customer_name extensions.gin_trgm_ops);
create index if not exists booking_contacts_email_trgm on public.booking_contacts using gin (email extensions.gin_trgm_ops);
create index if not exists listings_title_trgm on public.listings using gin (title extensions.gin_trgm_ops);
create index if not exists providers_display_name_trgm on public.providers using gin (display_name extensions.gin_trgm_ops);

-- Filters and the default orders.
create index if not exists bookings_created_idx on public.bookings (created_at desc) where status <> 'pending_payment';
create index if not exists bookings_status_created_idx on public.bookings (status, created_at desc);
create index if not exists bookings_kind_created_idx on public.bookings (kind, created_at desc);
create index if not exists bookings_when_idx on public.bookings ((coalesce(starts_at, created_at)));
create index if not exists listings_kind_updated_idx on public.listings (kind, updated_at desc);
create index if not exists listings_kind_status_idx on public.listings (kind, status);
create index if not exists providers_created_idx on public.providers (created_at desc);
create index if not exists providers_status_idx on public.providers (status);

-- ---------------------------------------------------------------------------
-- SHARED PIECES
-- ---------------------------------------------------------------------------

-- A provider's payout setup in words, the same rule as payoutSetupOf() in
-- @repo/types (a test checks they agree).
create or replace function public.provider_payout_setup(p_account_id text, p_charges boolean, p_payouts boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_account_id is null then 'not_started'
    when coalesce(p_charges, false) and coalesce(p_payouts, false) then 'ready'
    else 'in_progress'
  end
$$;
comment on function public.provider_payout_setup(text, boolean, boolean) is
  'A provider''s payout setup: not_started (no Stripe account), ready (charges and payouts enabled) or in_progress. Matches payoutSetupOf() in @repo/types.';

-- The search text as "contains" patterns, one per word: escaped, so % and _
-- match themselves; at most 8 words of up to 100 characters.
create or replace function public.admin_search_patterns(p_q text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg('%' || replace(replace(replace(left(w, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}')
  from (
    select w from unnest(regexp_split_to_array(lower(trim(coalesce(p_q, ''))), '\s+')) as w
    where w <> ''
    limit 8
  ) words
$$;
comment on function public.admin_search_patterns(text) is
  'Splits admin search text into escaped ILIKE "contains" patterns, one per word (at most 8). Used by the admin_*_page functions.';

-- ---------------------------------------------------------------------------
-- BOOKINGS
-- ---------------------------------------------------------------------------

create or replace function public.admin_bookings_page(
  p_q text default null,
  p_status text default null,
  p_kind text default null,
  p_provider_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_attention text default null,
  p_sort text default 'created',
  p_desc boolean default true,
  p_page integer default 1,
  p_page_size integer default 25,
  p_with_attention boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- The "needs attention" groups, written once: the counts and the filter use these.
  c_attention constant jsonb := jsonb_build_object(
    'reports', 'b.problem_reported_at is not null and b.problem_resolution is null and b.status <> ''cancelled''',
    'holds', 'f.payout_hold is not null and f.payout_hold <> ''problem_reported'' and b.status not in (''paid_out'', ''cancelled'')',
    'owed', 'f.reversal_failed_at is not null',
    'disputes', 'f.disputed_at is not null and f.dispute_closed_at is null',
    'unavailable', 'b.status = ''confirmed'' and (l.status <> ''live'' or p.status = ''suspended'')'
  );
  c_sorts constant jsonb := jsonb_build_object(
    'created', 'b.created_at',
    'when', 'coalesce(b.starts_at, b.created_at)',
    'status', 'b.status',
    'listing', 'l.title',
    -- Money columns sort by what was charged; never-charged bookings count as -1.
    'charged', 'case when b.confirmed_at is not null then b.total_cents else -1 end',
    'commission', 'case when b.confirmed_at is not null then f.commission_cents else -1 end',
    'provider_amount', 'case when b.confirmed_at is not null then f.provider_amount_cents else -1 end'
  );
  v_from constant text := '
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    join public.providers p on p.id = b.provider_id
    left join public.cities c on c.id = l.city_id
    left join public.booking_finances f on f.booking_id = b.id
    left join public.booking_contacts bc on bc.booking_id = b.id';
  v_where text := ' where b.status <> ''pending_payment''';
  v_patterns text[] := public.admin_search_patterns(p_q);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_cents integer;
  v_total bigint;
  v_rows jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if not c_sorts ? coalesce(p_sort, '') then
    raise exception 'Unknown sort: %', p_sort using errcode = 'invalid_parameter_value';
  end if;
  if p_attention is not null and not c_attention ? p_attention then
    raise exception 'Unknown attention group: %', p_attention using errcode = 'invalid_parameter_value';
  end if;

  -- Each word matches the customer's name or email, the listing's title, the
  -- provider's name, or (a number like 45 or $45.00) the amount charged.
  for i in 1 .. coalesce(array_length(v_patterns, 1), 0) loop
    v_cents := null;
    if trim(both '%' from v_patterns[i]) ~ '^\$?[0-9]+(\.[0-9]{1,2})?$' then
      v_cents := round(ltrim(trim(both '%' from v_patterns[i]), '$')::numeric * 100);
    end if;
    -- One id lookup per field, joined with UNION, so each can use its own
    -- index (trigram on name and email, the listing and provider indexes).
    v_where := v_where || format('
      and b.id in (
        select x.id from public.bookings x where x.customer_name ilike $1[%1$s]
        union select x.booking_id from public.booking_contacts x where x.email ilike $1[%1$s]
        union select x.id from public.bookings x
          where x.listing_id in (select y.id from public.listings y where y.title ilike $1[%1$s])
        union select x.id from public.bookings x
          where x.provider_id in (select y.id from public.providers y where y.display_name ilike $1[%1$s])%2$s)',
      i, case when v_cents is not null then format('
        union select x.id from public.bookings x where x.total_cents = %s', v_cents) else '' end);
  end loop;
  if p_status is not null then v_where := v_where || ' and b.status = $2'; end if;
  if p_kind is not null then v_where := v_where || ' and b.kind = $3'; end if;
  if p_provider_id is not null then v_where := v_where || ' and b.provider_id = $4'; end if;
  -- Calendar days in the booking's market time zone; the outer bounds (a day
  -- either side) let the index on coalesce(starts_at, created_at) narrow first.
  if p_from is not null then
    v_where := v_where || ' and coalesce(b.starts_at, b.created_at) >= ($5::date - 1)::timestamptz
      and (coalesce(b.starts_at, b.created_at) at time zone coalesce(c.timezone, ''America/New_York''))::date >= $5';
  end if;
  if p_to is not null then
    v_where := v_where || ' and coalesce(b.starts_at, b.created_at) < ($6::date + 2)::timestamptz
      and (coalesce(b.starts_at, b.created_at) at time zone coalesce(c.timezone, ''America/New_York''))::date <= $6';
  end if;
  if p_attention is not null then v_where := v_where || ' and (' || (c_attention ->> p_attention) || ')'; end if;

  -- The matches are found once, for both the total and the page. Only their
  -- ids and sort keys are sorted and cut to the page; the JSON is built for
  -- the page's rows only.
  execute format($q$
    with matched as materialized (
      select b.id, %3$s as s %1$s %2$s
    ), page as (
      select x.id, row_number() over (order by x.s %4$s nulls last, x.id %4$s) as n
      from (select id, s from matched order by s %4$s nulls last, id %4$s limit %5$s offset %6$s) x
    )
    select (select count(*) from matched), (select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'status', b.status, 'listing_id', b.listing_id, 'provider_id', b.provider_id,
        'starts_at', b.starts_at, 'ends_at', b.ends_at, 'created_at', b.created_at, 'party_size', b.party_size,
        'total_cents', b.total_cents, 'refunded_cents', b.refunded_cents, 'cancelled_by', b.cancelled_by,
        'confirmed_at', b.confirmed_at, 'payout_due_at', b.payout_due_at, 'problem_reported_at', b.problem_reported_at,
        'problem_resolution', b.problem_resolution, 'customer_name', b.customer_name, 'customer_email', bc.email,
        'commission_cents', f.commission_cents, 'provider_amount_cents', f.provider_amount_cents,
        'payout_hold', f.payout_hold, 'payout_failure', f.payout_failure, 'stripe_transfer_id', f.stripe_transfer_id,
        'disputed_at', f.disputed_at, 'dispute_closed_at', f.dispute_closed_at, 'dispute_outcome', f.dispute_outcome,
        'reversal_failed_at', f.reversal_failed_at,
        'listing', jsonb_build_object('title', l.title, 'kind', l.kind, 'status', l.status,
          'city', case when c.id is null then null else jsonb_build_object('name', c.name, 'timezone', c.timezone) end),
        'provider', jsonb_build_object('display_name', p.display_name, 'status', p.status)
      ) order by page.n), '[]'::jsonb)
    %1$s
    join page on page.id = b.id)
  $q$, v_from, v_where, c_sorts ->> p_sort, case when p_desc then 'desc' else 'asc' end, v_size, (v_page - 1) * v_size)
    into v_total, v_rows using v_patterns, p_status, p_kind, p_provider_id, p_from, p_to;

  -- The "needs attention" counts across every booking, not this page.
  if p_with_attention then
    execute 'select jsonb_build_object(' ||
      (select string_agg(format('%L, count(*) filter (where %s)', k, v), ', ') from jsonb_each_text(c_attention) as a(k, v)) ||
      ')' || v_from || ' where b.status <> ''pending_payment'''
      into v_counts;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'total_exact', true, 'attention', v_counts);
end;
$$;
comment on function public.admin_bookings_page(text, text, text, uuid, date, date, text, text, boolean, integer, integer, boolean) is
  'Admins only: one page of bookings (not pending payment) for the admin Bookings table, filtered by search text (customer name or email, listing title, provider name, or an amount), status, kind, provider, a date range (days in the market''s time zone) and a "needs attention" group; with the total and, if asked, the attention counts across all bookings.';

-- ---------------------------------------------------------------------------
-- LISTINGS (Experiences and Services)
-- ---------------------------------------------------------------------------

create or replace function public.admin_listings_page(
  p_kind text,
  p_q text default null,
  p_status text default null,
  p_city_id uuid default null,
  p_provider_id uuid default null,
  p_sort text default 'updated',
  p_desc boolean default true,
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
  c_sorts constant jsonb := jsonb_build_object(
    'updated', 'l.updated_at', 'title', 'l.title', 'price', 'l.price_cents', 'status', 'l.status',
    'provider', 'p.display_name', 'category', 'cat.name', 'city', 'c.name'
  );
  v_from constant text := '
    from public.listings l
    join public.providers p on p.id = l.provider_id
    left join public.categories cat on cat.id = l.category_id
    left join public.cities c on c.id = l.city_id';
  v_where text := ' where l.kind = $2';
  v_patterns text[] := public.admin_search_patterns(p_q);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind is null or p_kind not in ('service', 'experience') then
    raise exception 'Unknown kind: %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if not c_sorts ? coalesce(p_sort, '') then
    raise exception 'Unknown sort: %', p_sort using errcode = 'invalid_parameter_value';
  end if;

  -- Each word matches the title or the provider's name.
  for i in 1 .. coalesce(array_length(v_patterns, 1), 0) loop
    v_where := v_where || format('
      and l.id in (
        select x.id from public.listings x where x.title ilike $1[%1$s]
        union select x.id from public.listings x
          where x.provider_id in (select y.id from public.providers y where y.display_name ilike $1[%1$s]))', i);
  end loop;
  if p_status is not null then v_where := v_where || ' and l.status = $3'; end if;
  if p_city_id is not null then v_where := v_where || ' and l.city_id = $4'; end if;
  if p_provider_id is not null then v_where := v_where || ' and l.provider_id = $5'; end if;

  -- As for bookings: match once, sort and cut the ids, then build the page's JSON.
  execute format($q$
    with matched as materialized (
      select l.id, %3$s as s %1$s %2$s
    ), page as (
      select x.id, row_number() over (order by x.s %4$s nulls last, x.id %4$s) as n
      from (select id, s from matched order by s %4$s nulls last, id %4$s limit %5$s offset %6$s) x
    )
    select (select count(*) from matched), (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'title', l.title, 'status', l.status, 'price_cents', l.price_cents, 'updated_at', l.updated_at,
        'provider', jsonb_build_object('id', p.id, 'display_name', p.display_name),
        'category', case when cat.id is null then null else jsonb_build_object('name', cat.name) end,
        'city', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end
      ) order by page.n), '[]'::jsonb)
    %1$s
    join page on page.id = l.id)
  $q$, v_from, v_where, c_sorts ->> p_sort, case when p_desc then 'desc' else 'asc' end, v_size, (v_page - 1) * v_size)
    into v_total, v_rows using v_patterns, p_kind, p_status, p_city_id, p_provider_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'total_exact', true);
end;
$$;
comment on function public.admin_listings_page(text, text, text, uuid, uuid, text, boolean, integer, integer) is
  'Admins only: one page of Experiences or Services for the admin listings tables, filtered by search text (title or provider name), status, market and provider; with the total.';

-- ---------------------------------------------------------------------------
-- PROVIDERS (reads owners' emails, so security definer)
-- ---------------------------------------------------------------------------

create or replace function public.admin_providers_page(
  p_q text default null,
  p_status text default null,
  p_payout_setup text default null,
  p_city_id uuid default null,
  p_sort text default 'joined',
  p_desc boolean default true,
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
  c_sorts constant jsonb := jsonb_build_object(
    'joined', 'p.created_at', 'name', 'p.display_name', 'status', 'p.status', 'city', 'c.name',
    'payouts', 'public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled)'
  );
  v_from constant text := '
    from public.providers p
    join auth.users u on u.id = p.owner_id
    left join public.cities c on c.id = p.city_id';
  v_where text := ' where true';
  v_patterns text[] := public.admin_search_patterns(p_q);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_rows jsonb;
begin
  -- This function reads auth.users: this check is what keeps owners' emails private.
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if not c_sorts ? coalesce(p_sort, '') then
    raise exception 'Unknown sort: %', p_sort using errcode = 'invalid_parameter_value';
  end if;
  if p_payout_setup is not null and p_payout_setup not in ('not_started', 'in_progress', 'ready') then
    raise exception 'Unknown payout setup: %', p_payout_setup using errcode = 'invalid_parameter_value';
  end if;

  -- Each word matches the business name or the owner's email.
  for i in 1 .. coalesce(array_length(v_patterns, 1), 0) loop
    v_where := v_where || format(' and (p.display_name ilike $1[%1$s] or u.email ilike $1[%1$s])', i);
  end loop;
  if p_status is not null then v_where := v_where || ' and p.status = $2'; end if;
  if p_payout_setup is not null then
    v_where := v_where || ' and public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled) = $3';
  end if;
  if p_city_id is not null then v_where := v_where || ' and p.city_id = $4'; end if;

  -- As for bookings: match once, sort and cut the ids, then build the page's JSON.
  execute format($q$
    with matched as materialized (
      select p.id, %3$s as s %1$s %2$s
    ), page as (
      select x.id, row_number() over (order by x.s %4$s nulls last, x.id %4$s) as n
      from (select id, s from matched order by s %4$s nulls last, id %4$s limit %5$s offset %6$s) x
    )
    -- Only what the page shows: never the Stripe account id or the owner's id.
    select (select count(*) from matched), (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'status', p.status, 'created_at', p.created_at,
        'owner_email', u.email,
        'payout_setup', public.provider_payout_setup(p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled),
        'city', case when c.id is null then null else jsonb_build_object('name', c.name, 'state', c.state) end
      ) order by page.n), '[]'::jsonb)
    %1$s
    join page on page.id = p.id)
  $q$, v_from, v_where, c_sorts ->> p_sort, case when p_desc then 'desc' else 'asc' end, v_size, (v_page - 1) * v_size)
    into v_total, v_rows using v_patterns, p_status, p_payout_setup, p_city_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'total_exact', true);
end;
$$;
comment on function public.admin_providers_page(text, text, text, uuid, text, boolean, integer, integer) is
  'Admins only (security definer: reads owners'' emails from auth.users, guarded by is_admin()): one page of providers with their owner''s email and payout setup, filtered by search text (business name or owner email), status, payout setup and market; with the total. Also the provider pickers'' server-side search.';

-- ---------------------------------------------------------------------------
-- WHO MAY CALL THEM
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_bookings_page(text, text, text, uuid, date, date, text, text, boolean, integer, integer, boolean) from public, anon;
revoke execute on function public.admin_listings_page(text, text, text, uuid, uuid, text, boolean, integer, integer) from public, anon;
revoke execute on function public.admin_providers_page(text, text, text, uuid, text, boolean, integer, integer) from public, anon;
revoke execute on function public.admin_search_patterns(text) from public, anon;
revoke execute on function public.provider_payout_setup(text, boolean, boolean) from public, anon;
grant execute on function public.admin_bookings_page(text, text, text, uuid, date, date, text, text, boolean, integer, integer, boolean) to authenticated;
grant execute on function public.admin_listings_page(text, text, text, uuid, uuid, text, boolean, integer, integer) to authenticated;
grant execute on function public.admin_providers_page(text, text, text, uuid, text, boolean, integer, integer) to authenticated;
grant execute on function public.admin_search_patterns(text) to authenticated;
grant execute on function public.provider_payout_setup(text, boolean, boolean) to authenticated;
