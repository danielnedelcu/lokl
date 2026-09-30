-- Card copies of listing photos: a photo's card_path must be the card copy of
-- that same photo, it's optional, and it can't be changed after upload.
begin;
\ir _helpers/users.psql
select plan(10);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('a@test.local') as a \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'a', 'A Tours', :'atl') returning id as pa \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'pa', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 150, :'o4w')
returning id as la \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'pa', 'experience', :'exp', :'atl', 'Mural walk', 'Street art of Old Fourth Ward, on foot.', 3000, 90, :'o4w')
returning id as lb \gset

select :'pa' || '/' || :'la' || '/' as dir \gset
select :'pa' || '/' || :'lb' || '/' as other_dir \gset
select gen_random_uuid() as p1 \gset
select gen_random_uuid() as p2 \gset
select gen_random_uuid() as p3 \gset
select gen_random_uuid() as p4 \gset

select tests.authenticate_as(:'a');

-- 1. A photo can be added with its card copy...
select lives_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 0, 'Tacos on a picnic table') $$,
         :'la', :'dir' || :'p1' || '.webp', :'dir' || :'p1' || '.card.webp'),
  '1. a photo can be added with its card copy'
);

-- 1b. ...or a JPEG card copy, where the browser can't encode WebP (iPhones).
select lives_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 3, 'A plate of tacos al pastor') $$,
         :'la', :'dir' || :'p4' || '.jpg', :'dir' || :'p4' || '.card.jpg'),
  '1b. a photo can be added with a JPEG card copy'
);

-- 2. ...or without one (photos from before card copies).
select lives_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L, 1, 'The BeltLine at dusk') $$, :'la', :'dir' || :'p2' || '.jpg'),
  '2. a photo can be added without a card copy'
);

-- 3. The card copy must be of the same photo...
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 2, 'A taqueria counter') $$,
         :'la', :'dir' || :'p3' || '.webp', :'dir' || :'p1' || '.card.webp'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_card_path_check"',
  '3. a card copy of a different photo is refused'
);

-- 4. ...in the same folder.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 2, 'A taqueria counter') $$,
         :'la', :'dir' || :'p3' || '.webp', :'other_dir' || :'p3' || '.card.webp'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_card_path_check"',
  '4. a card copy in another listing''s folder is refused'
);

-- 5. It's the card path, not another file name or type.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 2, 'A taqueria counter') $$,
         :'la', :'dir' || :'p3' || '.webp', :'dir' || :'p3' || '.card.png'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_card_path_check"',
  '5a. a card copy must be .card.webp or .card.jpg, not .card.png'
);
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 2, 'A taqueria counter') $$,
         :'la', :'dir' || :'p3' || '.webp', :'dir' || gen_random_uuid() || '.card.jpg'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_card_path_check"',
  '5b. a JPEG card copy of a different photo is refused'
);
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, card_path, position, alt_text)
            values (%L, %L, %L, 2, 'A taqueria counter') $$,
         :'la', :'dir' || :'p3' || '.webp', :'dir' || :'p3' || '.thumb.jpg'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_card_path_check"',
  '5c. a card copy must be named <photo>.card.<type>'
);

-- 6. It can't be changed after upload.
select throws_ok(
  format($$ update listing_photos set card_path = null where storage_path = %L $$, :'dir' || :'p1' || '.webp'),
  '42501', 'permission denied for table listing_photos',
  '6. a provider cannot change a photo''s card copy'
);

-- 7. Signed-out visitors read it on a visible listing.
select tests.clear_authentication();
update listings set status = 'live', published_at = now() where id = :'la';
select tests.authenticate_as_anon();
select is(
  (select card_path from listing_photos where storage_path = :'dir' || :'p1' || '.webp'),
  :'dir' || :'p1' || '.card.webp',
  '7. a signed-out visitor reads the card copy''s path on a visible listing'
);

select * from finish();
rollback;
