-- Review star counts (docs/design/reviews.md, the rating breakdown;
-- 2026-10-04): how many published reviews gave each number of stars, per
-- listing and per provider, for the breakdown at the top of the Reviews
-- section ("5 stars: 8 reviews, 67%"). Kept by the same recount as the
-- count and average, so nothing is calculated per page load.

alter table public.listing_ratings
  add column stars_1 integer not null default 0 check (stars_1 >= 0),
  add column stars_2 integer not null default 0 check (stars_2 >= 0),
  add column stars_3 integer not null default 0 check (stars_3 >= 0),
  add column stars_4 integer not null default 0 check (stars_4 >= 0),
  add column stars_5 integer not null default 0 check (stars_5 >= 0);
alter table public.provider_ratings
  add column stars_1 integer not null default 0 check (stars_1 >= 0),
  add column stars_2 integer not null default 0 check (stars_2 >= 0),
  add column stars_3 integer not null default 0 check (stars_3 >= 0),
  add column stars_4 integer not null default 0 check (stars_4 >= 0),
  add column stars_5 integer not null default 0 check (stars_5 >= 0);
comment on column public.listing_ratings.stars_5 is 'Published reviews with 5 stars (stars_1 to stars_4 likewise). Kept by recount_ratings.';
comment on column public.provider_ratings.stars_5 is 'Published reviews with 5 stars (stars_1 to stars_4 likewise). Kept by recount_ratings.';

-- Readable wherever the count and average are (the same row rules).
grant select (stars_1, stars_2, stars_3, stars_4, stars_5) on public.listing_ratings to anon, authenticated;
grant select (stars_1, stars_2, stars_3, stars_4, stars_5) on public.provider_ratings to anon, authenticated;

-- The recount, now with the star counts.
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
    review_count = t.n, rating_total = t.total,
    stars_1 = t.s1, stars_2 = t.s2, stars_3 = t.s3, stars_4 = t.s4, stars_5 = t.s5,
    updated_at = now()
  from (select count(*)::integer as n, coalesce(sum(rating), 0)::integer as total,
               count(*) filter (where rating = 1)::integer as s1, count(*) filter (where rating = 2)::integer as s2,
               count(*) filter (where rating = 3)::integer as s3, count(*) filter (where rating = 4)::integer as s4,
               count(*) filter (where rating = 5)::integer as s5
        from public.reviews where listing_id = p_listing_id and status = 'published') t
  where lr.listing_id = p_listing_id;

  insert into public.provider_ratings (provider_id) values (p_provider_id) on conflict do nothing;
  perform 1 from public.provider_ratings where provider_id = p_provider_id for update;
  update public.provider_ratings pr set
    review_count = t.n, rating_total = t.total,
    stars_1 = t.s1, stars_2 = t.s2, stars_3 = t.s3, stars_4 = t.s4, stars_5 = t.s5,
    updated_at = now()
  from (select count(*)::integer as n, coalesce(sum(rating), 0)::integer as total,
               count(*) filter (where rating = 1)::integer as s1, count(*) filter (where rating = 2)::integer as s2,
               count(*) filter (where rating = 3)::integer as s3, count(*) filter (where rating = 4)::integer as s4,
               count(*) filter (where rating = 5)::integer as s5
        from public.reviews where provider_id = p_provider_id and status = 'published') t
  where pr.provider_id = p_provider_id;
end;
$$;
revoke execute on function public.recount_ratings(uuid, uuid) from public, anon, authenticated;

-- Fill in the counts for totals written before this migration.
update public.listing_ratings lr set
  stars_1 = t.s1, stars_2 = t.s2, stars_3 = t.s3, stars_4 = t.s4, stars_5 = t.s5
from (select listing_id,
             count(*) filter (where rating = 1)::integer as s1, count(*) filter (where rating = 2)::integer as s2,
             count(*) filter (where rating = 3)::integer as s3, count(*) filter (where rating = 4)::integer as s4,
             count(*) filter (where rating = 5)::integer as s5
      from public.reviews where status = 'published' group by listing_id) t
where lr.listing_id = t.listing_id;
update public.provider_ratings pr set
  stars_1 = t.s1, stars_2 = t.s2, stars_3 = t.s3, stars_4 = t.s4, stars_5 = t.s5
from (select provider_id,
             count(*) filter (where rating = 1)::integer as s1, count(*) filter (where rating = 2)::integer as s2,
             count(*) filter (where rating = 3)::integer as s3, count(*) filter (where rating = 4)::integer as s4,
             count(*) filter (where rating = 5)::integer as s5
      from public.reviews where status = 'published' group by provider_id) t
where pr.provider_id = t.provider_id;

-- The five counts always add up to the count.
alter table public.listing_ratings add constraint listing_ratings_stars_add_up
  check (stars_1 + stars_2 + stars_3 + stars_4 + stars_5 = review_count);
alter table public.provider_ratings add constraint provider_ratings_stars_add_up
  check (stars_1 + stars_2 + stars_3 + stars_4 + stars_5 = review_count);
