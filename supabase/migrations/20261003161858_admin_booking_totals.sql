-- The money totals for the admin's filtered bookings (charged, refunded,
-- commission kept), summed in the database across every match, not just the
-- page shown. They were summed in the browser before the table moved to
-- server pages (20261003072758_admin_search_pages) and dropped then.
--
-- admin_bookings_page is redefined with the same arguments, so its grants
-- (execute for signed-in users only) and its admin check stay as they were.
-- The only changes: the matched rows carry their money columns, and the
-- answer gains "totals". Delete behaviour: none (a function only).

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
  v_totals jsonb;
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
      select b.id, %3$s as s, b.confirmed_at is not null as charged, b.total_cents, b.refunded_cents, f.commission_cents
      %1$s %2$s
    ), page as (
      select x.id, row_number() over (order by x.s %4$s nulls last, x.id %4$s) as n
      from (select id, s from matched order by s %4$s nulls last, id %4$s limit %5$s offset %6$s) x
    )
    select (select count(*) from matched),
    -- The money across every match (not just this page), as the table shows
    -- it: only bookings that were charged; no commission kept on a booking
    -- refunded in full.
    (select jsonb_build_object(
        'charged_count', count(*) filter (where charged),
        'charged_cents', coalesce(sum(total_cents) filter (where charged), 0),
        'refunded_cents', coalesce(sum(refunded_cents) filter (where charged), 0),
        'commission_cents', coalesce(sum(case when refunded_cents >= total_cents then 0 else commission_cents end) filter (where charged), 0))
      from matched),
    (select coalesce(jsonb_agg(jsonb_build_object(
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
    into v_total, v_totals, v_rows using v_patterns, p_status, p_kind, p_provider_id, p_from, p_to;

  -- The "needs attention" counts across every booking, not this page.
  if p_with_attention then
    execute 'select jsonb_build_object(' ||
      (select string_agg(format('%L, count(*) filter (where %s)', k, v), ', ') from jsonb_each_text(c_attention) as a(k, v)) ||
      ')' || v_from || ' where b.status <> ''pending_payment'''
      into v_counts;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'total_exact', true, 'totals', v_totals, 'attention', v_counts);
end;
$$;


comment on function public.admin_bookings_page(text, text, text, uuid, date, date, text, text, boolean, integer, integer, boolean) is
  'Admins only: one page of bookings (not pending payment) for the admin Bookings table, filtered by search text (customer name or email, listing title, provider name, or an amount), status, kind, provider, a date range (days in the market''s time zone) and a "needs attention" group; with the total, the money totals across every match (charged, refunded, commission kept) and, if asked, the attention counts across all bookings.';
