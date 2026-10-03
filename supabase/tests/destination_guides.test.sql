-- Destination guides (part 1): admins write the draft side, only the server
-- publishes (with every rule checked), photos carry their credits, the
-- homepage shows only published guides, and visitors read nothing directly.
begin;
\ir _helpers/users.psql
select plan(51);

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('provider@test.local') as owner \gset
select tests.create_user('customer@test.local') as cust \gset
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = :'admin';
select id as atl from cities where slug = 'atlanta' \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as food \gset
insert into cities (slug, name, state, timezone) values ('savannah', 'Savannah', 'GA', 'America/New_York') returning id as sav \gset
insert into service_areas (city_id, kind, name) values (:'sav', 'neighborhood', 'Historic District') returning id as savarea \gset

-- ---------------------------------------------------------------------------
-- 1. WHO WRITES
-- ---------------------------------------------------------------------------

select tests.authenticate_as_admin(:'admin');
select lives_ok(format($$ insert into guides (market_id, slug, draft_title) values (%L, 'things-to-do-in-old-fourth-ward', 'Things to do in Old Fourth Ward') $$, :'atl'),
  '1a. an admin creates a guide');
select id as g from guides where slug = 'things-to-do-in-old-fourth-ward' \gset
select is((select status || '/' || created_by::text from guides where id = :'g'), 'draft/' || :'admin', '1b. ...as a draft, recorded as theirs');
select throws_ok(format($$ update guides set status = 'published' where id = %L $$, :'g'), '42501', NULL, '1c. an admin can''t publish by changing the status directly');
select throws_ok(format($$ update guides set title = 'Live title' where id = %L $$, :'g'), '42501', NULL, '1d. ...or write the live copy directly');
select throws_ok(format($$ update guides set ai_draft_pending_review = true where id = %L $$, :'g'),
  '23514', 'Only a new AI draft marks a guide as unreviewed.', '1e. ...or mark a guide unreviewed (only a new AI draft does)');
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'), '42501', NULL, '1f. ...or call the publish function from their sign-in (the server does)');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into guides (market_id, slug) values (%L, 'a-providers-guide') $$, :'atl'), '42501', NULL, '1g. a provider can''t write a guide');

-- ---------------------------------------------------------------------------
-- 2. PHOTOS AND CREDITS
-- ---------------------------------------------------------------------------

select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ insert into guide_photos (guide_id, storage_path, width, height, alt_text, source)
  values (%L, %L, 2400, 1350, 'Murals on the BeltLine', 'unsplash') $$, :'g', :'g' || '/' || gen_random_uuid() || '.webp'),
  '23514', NULL, '2a. an Unsplash photo needs its credit (name, profile and photo page)');
select throws_ok(format($$ insert into guide_photos (guide_id, storage_path, width, height, alt_text, source, credit_name, licence, source_url)
  values (%L, %L, 2400, 1350, 'Murals', 'other', 'A. Photographer', 'CC BY 4.0', 'https://example.com/photo') $$, :'g', :'g' || '/' || gen_random_uuid() || '.webp'),
  '23514', NULL, '2b. another licence needs commercial use confirmed');
insert into guide_photos (guide_id, storage_path, width, height, alt_text, source, credit_name, credit_url, source_url)
values (:'g', :'g' || '/' || gen_random_uuid() || '.webp', 2400, 1350, 'Murals along the Eastside Trail', 'unsplash',
        'Jordan Example', 'https://unsplash.com/@example', 'https://unsplash.com/photos/abc')
returning id as cover \gset
select ok(:'cover' is not null, '2c. an Unsplash photo with its credit is kept');
insert into guide_photos (guide_id, storage_path, width, height, alt_text, source)
values (:'g', :'g' || '/' || gen_random_uuid() || '.jpg', 1600, 900, 'A small photo', 'own') returning id as small \gset
insert into guide_photos (guide_id, storage_path, width, height, alt_text, source)
values (:'g', :'g' || '/' || gen_random_uuid() || '.jpg', 1400, 2200, 'A tall photo', 'own') returning id as tall \gset
select ok(:'small' is not null, '2d. an own photo needs no credit');
select throws_ok(format($$ insert into guide_photos (guide_id, storage_path, width, height, alt_text, source) values (%L, %L, 2400, 1350, '', 'own') $$, :'g', :'g' || '/' || gen_random_uuid() || '.jpg'),
  '23514', NULL, '2e. every photo needs alt text');
insert into guides (market_id, slug) values (:'atl', 'another-guide') returning id as g2 \gset
select throws_ok(format($$ insert into guide_photos (guide_id, storage_path, width, height, alt_text, source) values (%L, %L, 2400, 1350, 'Murals', 'own') $$, :'g2', :'g' || '/' || gen_random_uuid() || '.jpg'),
  '23514', 'A guide''s photo has to be in that guide''s own folder.', '2g. a photo''s file must be in its own guide''s folder');
select throws_ok(format($$ update guides set draft_area_id = %L where id = %L $$, :'savarea', :'g2'),
  '23514', 'That area isn''t in this guide''s market.', '2h. a guide''s area must be in its market');
select lives_ok(format($$ update guides set draft_area_id = %L where id = %L $$, :'o4w', :'g2'), '2i. ...an area in its market is fine');
select throws_ok(format($$ update guides set draft_cover_photo_id = %L where id = %L $$, :'cover', :'g2'),
  '23514', 'The cover has to be one of this guide''s photos.', '2f. a guide''s cover is one of its own photos');

-- ---------------------------------------------------------------------------
-- 3. PUBLISHING: every rule, then the allowed case (as the server)
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'owner'), '42501', 'Only an admin can publish a guide.', '3a. the id passed must be an admin''s');
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'),
  '23514', 'Add a teaser of at least 20 characters. It shows under the photo and in search results.', '3b. a teaser is needed');
update guides set draft_teaser = 'Murals, food halls and the Eastside Trail, a short walk from downtown.' where id = :'g';
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'), '23514', 'Write the guide before publishing it.', '3c. a body is needed');
update guides set draft_body = '{"blocks": [{"type": "paragraph", "data": {"text": "Old Fourth Ward sits east of downtown."}}]}' where id = :'g';
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'),
  '23514', 'Choose an area or a category, so the guide can show matching listings.', '3d. an area or a category is needed');
update guides set draft_area_id = :'o4w', ai_draft_pending_review = true where id = :'g';
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'),
  '23514', 'This AI draft hasn''t been reviewed yet. Check the highlighted phrases and the facts, then mark it reviewed.', '3e. an unreviewed AI draft can''t be published');
select tests.authenticate_as_admin(:'admin');
update guides set ai_draft_pending_review = false where id = :'g';
select is((select ai_reviewed_by from guides where id = :'g'), :'admin'::uuid, '3f. marking it reviewed records who');
select tests.authenticate_as_service_role();
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'), '23514', 'Add a cover photo.', '3g. a cover is needed');
update guides set draft_cover_photo_id = :'small' where id = :'g';
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'),
  '23514', 'The cover photo needs to be landscape and at least 2,000 by 1,125 pixels (this one is 1600 by 900).', '3h. a cover smaller than 2,000 x 1,125 is refused');
update guides set draft_cover_photo_id = :'tall' where id = :'g';
select throws_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'), '23514', NULL, '3i. a portrait cover is refused');
update guides set draft_cover_photo_id = :'cover' where id = :'g';
select lives_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'admin'), '3j. with everything in place, it''s published');
select is((select status || '|' || title || '|' || (cover_photo_id = :'cover')::text || '|' || (published_at is not null)::text from guides where id = :'g'),
  'published|Things to do in Old Fourth Ward|true|true', '3k. ...the draft is copied to the live copy');
select is((select count(*)::int from guide_versions where guide_id = :'g' and published_by = :'admin'), 1, '3l. ...and a version is kept');
select is((select area_id from guides where id = :'g'), :'o4w'::uuid, '3m. ...including the listings block''s area');

-- 3n-3p. The listings block is a draft like the rest: editing it changes
-- nothing live until it's published.
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ update guides set area_id = null where id = %L $$, :'g'), '42501', NULL, '3n. an admin can''t change the live listings block directly');
update guides set draft_category_id = :'food', draft_listing_kind = 'experience' where id = :'g';
select is((select coalesce(category_id::text, 'none') || '/' || coalesce(listing_kind, 'any') from guides where id = :'g'), 'none/any',
  '3o. editing the draft''s category and kind leaves the live block unchanged');
select tests.authenticate_as_service_role();

-- 4. Publishing again: "Last updated" moves only when the content changed.
select content_updated_at as first_update from guides where id = :'g' \gset
update guides set draft_category_id = null, draft_listing_kind = null where id = :'g';
select publish_guide(:'g', :'admin');
select is((select content_updated_at from guides where id = :'g'), :'first_update'::timestamptz, '4a. republishing unchanged content keeps "Last updated"');
update guides set content_updated_at = content_updated_at - interval '1 day' where id = :'g';
update guides set draft_teaser = 'Murals, food halls and the Eastside Trail, a short walk east of downtown.' where id = :'g';
select publish_guide(:'g', :'admin');
select ok((select content_updated_at from guides where id = :'g') > :'first_update'::timestamptz - interval '1 day', '4b. publishing a change moves "Last updated"');
select is((select count(*)::int from guide_versions where guide_id = :'g'), 3, '4c. each publish keeps a version');
update guides set draft_category_id = :'food', draft_listing_kind = 'experience' where id = :'g';
select publish_guide(:'g', :'admin');
select is((select category_id::text || '/' || listing_kind from guides where id = :'g'), :'food' || '/experience', '4d. publishing copies the listings block across');

-- 5. A published guide keeps its address and isn't deleted.
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ update guides set slug = 'old-fourth-ward' where id = %L $$, :'g'),
  '23514', 'This guide has been published, so its address can''t change.', '5a. a published guide''s slug can''t change');
select throws_ok(format($$ delete from guides where id = %L $$, :'g'),
  '23514', 'A guide that has been published is unpublished, not deleted.', '5b. a published guide can''t be deleted');
select lives_ok(format($$ delete from guides where id = %L $$, :'g2'), '5c. a guide never published can be deleted');

-- ---------------------------------------------------------------------------
-- 6. THE HOMEPAGE
-- ---------------------------------------------------------------------------

insert into guides (market_id, slug, draft_title) values (:'atl', 'food-tours-in-atlanta', 'Food tours in Atlanta') returning id as g3 \gset
select throws_ok(format($$ insert into homepage_features (position, guide_id) values (2, %L) $$, :'g3'),
  '23514', 'Only a published guide can be on the homepage.', '6a. only a published guide can be featured');
select lives_ok(format($$ insert into homepage_features (position, guide_id) values (1, %L) $$, :'g'), '6b. a published guide is featured as the hero');
select throws_ok(format($$ insert into homepage_features (position, guide_id) values (6, %L) $$, :'g'), '23514', NULL, '6c. there are five places at most (hero and four cards)');
select tests.authenticate_as_anon();
select is((select count(*)::int from homepage_features), 1, '6d. a signed-out visitor reads the homepage features');
select tests.authenticate_as(:'cust');
-- (A delete is limited to the rows the caller may change, which for a
-- customer is none: nothing happens.)
delete from homepage_features where guide_id = :'g';
select tests.authenticate_as_anon();
select is((select count(*)::int from homepage_features), 1, '6e. a customer can''t remove a homepage feature');

-- 6f-6h. The photo bucket: admins upload into an existing guide's folder only.
select tests.authenticate_as_admin(:'admin');
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('guide-photos', %L || '/upload-1.webp') $$, :'g'),
  '6f. an admin uploads a photo into a guide''s folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('guide-photos', %L || '/upload-2.webp') $$, gen_random_uuid()),
  '42501', NULL, '6g. ...but not into a folder that isn''t a guide''s');
select tests.authenticate_as(:'owner');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('guide-photos', %L || '/upload-3.webp') $$, :'g'),
  '42501', NULL, '6h. a provider can''t upload guide photos');

-- ---------------------------------------------------------------------------
-- 7. UNPUBLISHING, AND WHO READS WHAT
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select unpublish_guide(:'g', :'admin');
select is((select status from guides where id = :'g'), 'unpublished', '7a. the server unpublishes a guide');
select is((select count(*)::int from homepage_features where guide_id = :'g'), 0, '7b. ...and it leaves the homepage at once');
select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from guides $$, '42501', NULL, '7c. signed-out visitors read no guides directly (the website''s server does)');
select tests.authenticate_as(:'owner');
select is((select count(*)::int from guides) + (select count(*)::int from guide_versions) + (select count(*)::int from guide_ai_drafts), 0,
  '7d. a provider reads no guides, versions or AI drafts');
select tests.authenticate_as_admin(:'admin');
select ok((select count(*) from guides) = 2 and (select count(*) from guide_versions) = 4, '7e. the admin reads every guide and version');

select * from finish();
rollback;
