-- What visitors read of destination guides, and the admin's homepage choice
-- (20261003162751_public_guides): published guides only, their live copy
-- only (never a draft, the AI review fields or who wrote it), only the
-- photos the live copy uses; nothing for drafts, unpublished guides or
-- inactive markets. The homepage list is set by admins only, in one step.
begin;
\ir _helpers/users.psql
select plan(31);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('customer@test.local') as cust \gset
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = :'admin';
select id as atl from cities where slug = 'atlanta' \gset
insert into cities (slug, name, state, timezone, active) values ('closedtown', 'Closedtown', 'GA', 'America/New_York', true) returning id as closed \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into categories (kind, name, slug) values ('experience', 'Food tours', 'food-tours') returning id as cat \gset

-- A guide with a cover, a body photo and a photo it doesn't use, published
-- by the server; plus a never-published draft, an unpublished guide, a
-- second published guide, and one in a market that is then closed.
create function pg_temp.guide(p_market uuid, p_slug text, p_title text) returns uuid language plpgsql as $$
declare g uuid; c uuid; b uuid;
begin
  insert into public.guides (market_id, slug, draft_title, draft_teaser, draft_area_id)
  values (p_market, p_slug, p_title, 'A walk past the murals, and who to book for a tour.',
          (select id from public.service_areas where city_id = p_market limit 1))
  returning id into g;
  insert into public.guide_photos (guide_id, storage_path, width, height, alt_text, source)
  values (g, g || '/' || gen_random_uuid() || '.webp', 2400, 1350, 'The cover', 'own') returning id into c;
  insert into public.guide_photos (guide_id, storage_path, width, height, alt_text, source, credit_name, credit_url, source_url)
  values (g, g || '/' || gen_random_uuid() || '.webp', 1200, 800, 'In the body', 'unsplash', 'Jordan Example',
          'https://unsplash.com/@example', 'https://unsplash.com/photos/abc') returning id into b;
  insert into public.guide_photos (guide_id, storage_path, width, height, alt_text, source)
  values (g, g || '/' || gen_random_uuid() || '.webp', 1200, 800, 'Not used', 'own');
  update public.guides set draft_cover_photo_id = c,
    draft_body = jsonb_build_object('blocks', jsonb_build_array(
      jsonb_build_object('type', 'paragraph', 'data', jsonb_build_object('text', 'The live words.')),
      jsonb_build_object('type', 'photo', 'data', jsonb_build_object('photoId', b))))
  where id = g;
  return g;
end;
$$;
insert into service_areas (city_id, kind, name) values (:'closed', 'neighborhood', 'Closed area');
select pg_temp.guide(:'atl', 'murals-of-the-trail', 'Murals of the trail') as g1 \gset
select pg_temp.guide(:'atl', 'a-draft', 'A draft') as g2 \gset
select pg_temp.guide(:'atl', 'taken-down', 'Taken down') as g3 \gset
select pg_temp.guide(:'atl', 'second-guide', 'Second guide') as g4 \gset
select pg_temp.guide(:'closed', 'closed-guide', 'Closed guide') as g5 \gset
update guides set draft_category_id = :'cat', draft_listing_kind = null where id = :'g1';

select tests.authenticate_as_service_role();
select publish_guide(:'g1', :'admin');
select publish_guide(:'g3', :'admin');
select publish_guide(:'g4', :'admin');
select publish_guide(:'g5', :'admin');
select unpublish_guide(:'g3', :'admin');
select tests.clear_authentication();
update cities set active = false where id = :'closed';
-- After publishing, the draft moves on: visitors must still see the live copy.
update guides set draft_title = 'SECRET DRAFT TITLE', draft_teaser = 'SECRET DRAFT TEASER, not yet published anywhere.',
  draft_body = '{"blocks": [{"type": "paragraph", "data": {"text": "SECRET DRAFT BODY"}}]}' where id = :'g1';
select id as unused from guide_photos where guide_id = :'g1' and alt_text = 'Not used' \gset
select id as body_photo from guide_photos where guide_id = :'g1' and alt_text = 'In the body' \gset
select cover_photo_id as cover from guides where id = :'g1' \gset

-- ---------------------------------------------------------------------------
-- 1. THE INDEX
-- ---------------------------------------------------------------------------

select tests.authenticate_as_anon();
select is((select array_agg(x ->> 'slug' order by x ->> 'slug') from jsonb_array_elements(public_guides('atlanta') -> 'guides') x),
  array['murals-of-the-trail', 'second-guide'], '1a. a signed-out visitor sees the published guides only (no draft, nothing unpublished)');
select is((select x ->> 'title' from jsonb_array_elements(public_guides('atlanta') -> 'guides') x where x ->> 'slug' = 'murals-of-the-trail'),
  'Murals of the trail', '1b. ...with the live title, not the newer draft');
select ok(public_guides('atlanta')::text !~* 'secret draft|draft_|ai_|created_by', '1c. ...and no draft text or private field anywhere in the answer');
select is(public_guides('atlanta') -> 'guides' -> 0 -> 'cover' ->> 'alt', 'The cover', '1d. ...each with its cover and alt text');
select is(public_guides('atlanta') -> 'market' ->> 'timezone', 'America/New_York', '1d2. the market comes with its time zone, for dates');
select is(public_guides('closedtown'), null, '1e. a market that isn''t public has no index');
select is(public_guides('nowhere'), null, '1f. ...nor does an unknown one');

-- ---------------------------------------------------------------------------
-- 2. ONE GUIDE
-- ---------------------------------------------------------------------------

select is(public_guide('atlanta', 'murals-of-the-trail') ->> 'title', 'Murals of the trail', '2a. a published guide''s live title');
select is(public_guide('atlanta', 'murals-of-the-trail') -> 'body' -> 'blocks' -> 0 -> 'data' ->> 'text', 'The live words.',
  '2b. ...and its live body, while a newer draft waits');
select ok(public_guide('atlanta', 'murals-of-the-trail')::text !~* 'secret draft|draft_|ai_|created_by|ai_reviewed',
  '2c. no draft text or private field in the guide''s answer');
select is((select array_agg((x ->> 'id')::uuid order by x ->> 'alt') from jsonb_array_elements(public_guide('atlanta', 'murals-of-the-trail') -> 'photos') x),
  array[:'body_photo'::uuid, :'cover'::uuid], '2d. only the photos the live copy uses: the cover and the body''s');
select ok(public_guide('atlanta', 'murals-of-the-trail')::text !~ :'unused', '2e. ...never the photo it doesn''t use');
select is((select x ->> 'credit_name' from jsonb_array_elements(public_guide('atlanta', 'murals-of-the-trail') -> 'photos') x where x ->> 'alt' = 'In the body'),
  'Jordan Example', '2f. photos carry their credit');
select is(public_guide('atlanta', 'murals-of-the-trail') -> 'listings' -> 'category' ->> 'slug', 'food-tours', '2g. the live listings block''s category');
select is(public_guide('atlanta', 'murals-of-the-trail') -> 'listings' -> 'area' ->> 'name', 'Old Fourth Ward', '2h. ...and area');
select is(public_guide('atlanta', 'a-draft'), null, '2i. a draft isn''t there');
select is(public_guide('atlanta', 'taken-down'), null, '2j. nor is an unpublished guide');
select is(public_guide('closedtown', 'closed-guide'), null, '2k. nor a guide in a market that isn''t public');
select is(public_guide('nowhere', 'murals-of-the-trail'), null, '2l. nor a guide asked for in the wrong market');
select tests.authenticate_as(:'cust');
select is(public_guide('atlanta', 'murals-of-the-trail') ->> 'title', 'Murals of the trail', '2m. signed-in visitors read the same');

-- ---------------------------------------------------------------------------
-- 3. THE HOMEPAGE
-- ---------------------------------------------------------------------------

select throws_ok(format($$ select admin_set_homepage_features(array[%L]::uuid[]) $$, :'g1'), '42501', 'Admins only.',
  '3a. a customer can''t choose the homepage guides');
select tests.authenticate_as_anon();
select throws_ok(format($$ select admin_set_homepage_features(array[%L]::uuid[]) $$, :'g1'), '42501', NULL,
  '3b. ...nor can a signed-out visitor');
select tests.authenticate_as_admin(:'admin');
select lives_ok(format($$ select admin_set_homepage_features(array[%L, %L]::uuid[]) $$, :'g4', :'g1'), '3c. the admin chooses two, in order');
select tests.authenticate_as_anon();
select is((select array_agg(x ->> 'slug' order by (x ->> 'position')::int) from jsonb_array_elements(public_homepage_guides()) x),
  array['second-guide', 'murals-of-the-trail'], '3d. visitors see them in that order, the first as the hero');
select ok(public_homepage_guides()::text !~* 'secret draft|draft_|ai_', '3e. ...with the live copy only');
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ select admin_set_homepage_features(array[%L, %L]::uuid[]) $$, :'g1', :'g2'), '23514', 'Only a published guide can be on the homepage.',
  '3f. a draft can''t be featured');
select is((select array_agg(guide_id order by position) from homepage_features), array[:'g4'::uuid, :'g1'::uuid],
  '3g. ...and the refused change left the homepage as it was (one step: all or nothing)');
select throws_ok(format($$ select admin_set_homepage_features(array[%L, %L]::uuid[]) $$, :'g1', :'g1'), '23514', 'Each guide can be on the homepage once.',
  '3h. a guide can''t be featured twice');
select throws_ok($$ select admin_set_homepage_features(array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]) $$,
  '23514', 'The homepage shows up to 5 guides.', '3i. at most five');
select tests.authenticate_as_service_role();
select unpublish_guide(:'g4', :'admin');
select tests.authenticate_as_anon();
select is((select array_agg(x ->> 'slug') from jsonb_array_elements(public_homepage_guides()) x), array['murals-of-the-trail'],
  '3j. unpublishing a guide takes it off the homepage at once');
select tests.authenticate_as_admin(:'admin');
select lives_ok($$ select admin_set_homepage_features('{}'::uuid[]) $$, '3k. the admin can clear the homepage (it shows the headline again)');

select * from finish();
rollback;
