-- Access, status and storage rules for listing photos. Every allowed case is
-- paired with the blocked case next to it.
begin;
\ir _helpers/users.psql
select plan(54);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('a@test.local') as a \gset
select tests.create_user('b@test.local') as b \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'a', 'A Studio', :'atl') returning id as pa \gset
insert into providers (owner_id, display_name, city_id) values (:'b', 'B Tours', :'atl') returning id as pb \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset

-- A's studio Service (draft) and B's studio Service (draft).
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pa', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'o4w')
returning id as la \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pb', 'service', :'svc', :'atl', 'B studio haircut', 'Another provider''s studio service.', 5000, 'provider_location', :'o4w')
returning id as lb \gset

-- Paths: <provider>/<listing>/<uuid>.jpg
select :'pa' || '/' || :'la' || '/' as a_dir \gset
select :'pb' || '/' || :'lb' || '/' as b_dir \gset

-- ---------------------------------------------------------------------------
-- ADDING PHOTOS
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 1. A provider can add a photo to their own listing...
select lives_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 0, 'The studio chair and mirror') $$, :'la', :'a_dir'),
  '1. a provider can add a photo to their own listing'
);

-- 2. ...but not to another provider's.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 0, 'Someone else''s listing') $$, :'lb', :'b_dir'),
  '42501', 'new row violates row-level security policy for table "listing_photos"',
  '2. a provider cannot add a photo to another provider''s listing'
);

-- 3. The file must be in the listing's own folder.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 1, 'Borrowing another provider''s file') $$, :'la', :'b_dir'),
  '23514', 'The photo must be uploaded to this listing''s own folder.',
  '3. a photo must point at a file in its listing''s own folder'
);

-- 4. Alt text is required, 5 to 200 characters.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 1, 'Pic') $$, :'la', :'a_dir'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_alt_text_check"',
  '4. alt text needs at least 5 characters'
);

-- 5. Only images in the expected path format.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || 'photo.gif', 1, 'An animated image') $$, :'la', :'a_dir'),
  '23514', 'new row for relation "listing_photos" violates check constraint "listing_photos_storage_path_check"',
  '5. a photo path is <provider>/<listing>/<uuid>.<jpg|jpeg|png|webp>'
);

-- 6. Two photos can't share a position.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 0, 'A second cover photo') $$, :'la', :'a_dir'),
  '23505', 'duplicate key value violates unique constraint "listing_photos_listing_id_position_key"',
  '6. positions are unique per listing'
);

-- 7. Up to 8 photos; a ninth is refused.
select lives_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            select %L, %L || gen_random_uuid() || '.jpg', n, 'Photo number ' || n from generate_series(1, 7) n $$, :'la', :'a_dir'),
  '7a. a listing can have 8 photos'
);
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 7, 'One photo too many') $$, :'la', :'a_dir'),
  '23514', 'A listing can have up to 8 photos. Remove one to add another.',
  '7b. a ninth photo is refused'
);

-- 8. Signed-out visitors can't add photos.
select tests.authenticate_as_anon();
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 1, 'Anonymous photo') $$, :'la', :'a_dir'),
  '42501', 'permission denied for table listing_photos',
  '8. a signed-out visitor cannot add photos'
);

-- ---------------------------------------------------------------------------
-- EDITING AND REORDERING
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select id as cover from listing_photos where listing_id = :'la' and position = 0 \gset
select id as second from listing_photos where listing_id = :'la' and position = 1 \gset
-- The current order, as an array.
select array_agg(id order by position) as order_now from listing_photos where listing_id = :'la' \gset

select tests.authenticate_as(:'a');

-- 9. A provider can change a photo's alt text; the file itself is fixed.
select lives_ok(
  format($$ update listing_photos set alt_text = 'The studio chair, mirror and plants' where id = %L $$, :'cover'),
  '9a. a provider can change a photo''s alt text'
);
select throws_ok(
  format($$ update listing_photos set storage_path = %L || gen_random_uuid() || '.jpg' where id = %L $$, :'a_dir', :'cover'),
  '42501', 'permission denied for table listing_photos',
  '9b. a provider cannot point a photo at a different file'
);

-- 10. Reordering swaps positions in one go: the second photo becomes the cover.
select lives_ok(
  format($$ select reorder_listing_photos(%L, %L::uuid[] ) $$, :'la',
         (select array_prepend(:'second'::uuid, array_remove(:'order_now'::uuid[], :'second'::uuid)))),
  '10a. a provider can reorder their listing''s photos'
);
select tests.clear_authentication();
select is((select id from listing_photos where listing_id = :'la' and position = 0), :'second'::uuid, '10b. ...and the chosen photo is now the cover');
select is((select id from listing_photos where listing_id = :'la' and position = 1), :'cover'::uuid, '10c. ...and the old cover moved down one');

-- 11. Reordering must list every photo exactly once.
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ select reorder_listing_photos(%L, array[%L]::uuid[]) $$, :'la', :'cover'),
  '23514', 'List every photo of the listing exactly once.',
  '11. reordering with some photos missing is refused'
);

-- 12. Another provider can't reorder them, and is told why.
select tests.authenticate_as(:'b');
select throws_ok(
  format($$ select reorder_listing_photos(%L, %L::uuid[]) $$, :'la', :'order_now'),
  '42501', 'You can only reorder the photos of your own listings.',
  '12a. another provider cannot reorder a listing''s photos'
);
-- ...and nothing moved.
select tests.clear_authentication();
select is((select id from listing_photos where listing_id = :'la' and position = 0), :'second'::uuid, '12b. ...and the order is unchanged');

-- 13. Signed-out visitors can't call reorder at all.
select tests.authenticate_as_anon();
select throws_ok(
  format($$ select reorder_listing_photos(%L, %L::uuid[]) $$, :'la', :'order_now'),
  '42501', 'permission denied for function reorder_listing_photos',
  '13. a signed-out visitor cannot reorder photos'
);

-- ---------------------------------------------------------------------------
-- READING
-- ---------------------------------------------------------------------------

-- 14. A draft's photos are private to the owner (and the admin).
select tests.authenticate_as_anon();
select is((select count(*)::int from listing_photos where listing_id = :'la'), 0, '14a. a signed-out visitor cannot see a draft''s photos');
select tests.authenticate_as(:'b');
select is((select count(*)::int from listing_photos where listing_id = :'la'), 0, '14b. another provider cannot see a draft''s photos');
select tests.authenticate_as(:'a');
select is((select count(*)::int from listing_photos where listing_id = :'la'), 8, '14c. the owner sees all their listing''s photos');
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from listing_photos where listing_id = :'la'), 8, '14d. the admin sees all photos');

-- ---------------------------------------------------------------------------
-- A PHOTO IS REQUIRED TO PUBLISH OR SUBMIT
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

-- 15. Publishing or submitting with zero photos fails.
select throws_ok(
  format($$ update listings set status = 'live', published_at = now() where id = %L $$, :'lb'),
  '23514', 'Add at least one photo before publishing.',
  '15a. publishing a listing with zero photos fails'
);
select throws_ok(
  format($$ update listings set status = 'submitted' where id = %L $$, :'lb'),
  '23514', 'Add at least one photo before sending it for review.',
  '15b. submitting a listing with zero photos fails'
);

-- 16. With a photo, publishing works, and signed-out visitors see the photos.
select lives_ok(
  format($$ update listings set status = 'live', published_at = now() where id = %L $$, :'la'),
  '16a. publishing a listing with photos works'
);
select tests.authenticate_as_anon();
select is((select count(*)::int from listing_photos where listing_id = :'la'), 8, '16b. a signed-out visitor sees a live listing''s photos');

-- ---------------------------------------------------------------------------
-- LIVE: photos can change, but not down to none
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 17. On a live listing, photos can be removed and alt text changed...
select lives_ok(
  format($$ delete from listing_photos where listing_id = %L and position between 2 and 7 $$, :'la'),
  '17a. a provider can remove photos from a live listing'
);
select lives_ok(
  format($$ update listing_photos set alt_text = 'The chair by the window' where id = %L $$, :'second'),
  '17b. a provider can change alt text on a live listing'
);

-- 18. ...but never down to zero, for anyone.
select lives_ok(
  format($$ delete from listing_photos where id = %L $$, :'cover'),
  '18a. a provider can remove the second-to-last photo'
);
select throws_ok(
  format($$ delete from listing_photos where id = %L $$, :'second'),
  '23514', 'A live listing needs at least one photo. Add another photo first, or unlist it.',
  '18b. a provider cannot remove the last photo of a live listing'
);
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  format($$ delete from listing_photos where id = %L $$, :'second'),
  '23514', 'A live listing needs at least one photo. Add another photo first, or unlist it.',
  '18c. nor can the admin'
);

-- 19. The admin can remove a photo when it isn't the last one.
select tests.clear_authentication();
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'la', :'a_dir' || gen_random_uuid() || '.jpg', 1, 'A photo the admin will remove') returning id as extra \gset
select tests.authenticate_as_admin(:'admin');
select lives_ok(format($$ delete from listing_photos where id = %L $$, :'extra'), '19a. the admin can remove a photo');
select tests.authenticate_as(:'b');
select lives_ok(format($$ delete from listing_photos where listing_id = %L $$, :'la'), '19b. another provider removing photos raises no error');
select tests.clear_authentication();
select is((select count(*)::int from listing_photos where listing_id = :'la'), 1, '19c. ...and the photo is kept');

-- ---------------------------------------------------------------------------
-- SUBMITTED AND UNPUBLISHED: locked
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
update listings set status = 'submitted' where id = :'la';
select tests.authenticate_as(:'a');

-- 20. While submitted, photos can't be added, changed or removed.
select throws_ok(
  format($$ insert into listing_photos (listing_id, storage_path, position, alt_text)
            values (%L, %L || gen_random_uuid() || '.jpg', 2, 'Added during review') $$, :'la', :'a_dir'),
  '23514', 'This listing''s photos can''t be changed while it is submitted.',
  '20a. a provider cannot add a photo to a submitted listing'
);
select throws_ok(
  format($$ update listing_photos set alt_text = 'Changed during review' where id = %L $$, :'second'),
  '23514', 'This listing''s photos can''t be changed while it is submitted.',
  '20b. a provider cannot change a submitted listing''s photos'
);

-- 21. The same while unpublished.
select tests.clear_authentication();
update listings set status = 'unpublished' where id = :'la';
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ update listing_photos set alt_text = 'Changed while taken down' where id = %L $$, :'second'),
  '23514', 'This listing''s photos can''t be changed while it is unpublished.',
  '21. a provider cannot change an unpublished listing''s photos'
);

-- 22. Back to a draft: free again, down to none.
select tests.clear_authentication();
update listings set status = 'draft' where id = :'la';
select tests.authenticate_as(:'a');
select lives_ok(format($$ delete from listing_photos where listing_id = %L $$, :'la'), '22a. a provider can remove every photo from a draft');
select tests.clear_authentication();
select is((select count(*)::int from listing_photos where listing_id = :'la'), 0, '22b. ...and none are left');

-- ---------------------------------------------------------------------------
-- STORAGE: the listing-photos bucket
-- ---------------------------------------------------------------------------

-- 23. The bucket is public, 5 MB, JPEG, PNG or WebP.
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'listing-photos' $$,
  $$ values (true, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp']::text[]) $$,
  '23. the listing-photos bucket is public, 5 MB, JPEG, PNG or WebP'
);

select tests.authenticate_as(:'a');

-- 24. A provider can upload into their own listing's folder...
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L || 'upload-1.jpg') $$, :'a_dir'),
  '24. a provider can upload into their own listing''s folder'
);

-- 25. ...not into another provider's folder...
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L || 'upload-2.jpg') $$, :'b_dir'),
  '42501', 'new row violates row-level security policy for table "objects"',
  '25. a provider cannot upload into another provider''s folder'
);

-- 26. ...nor their own folder under a listing that isn't theirs...
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L || '/' || %L || '/upload-3.jpg') $$, :'pa', :'lb'),
  '42501', 'new row violates row-level security policy for table "objects"',
  '26. a provider cannot upload under another provider''s listing'
);

-- 27. ...nor into another bucket.
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('avatars', %L || 'upload-4.jpg') $$, :'a_dir'),
  '42501', 'new row violates row-level security policy for table "objects"',
  '27. a provider cannot upload into another bucket'
);

-- 28. Signed-out visitors can't upload.
select tests.authenticate_as_anon();
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L || 'upload-5.jpg') $$, :'a_dir'),
  '42501', 'new row violates row-level security policy for table "objects"',
  '28. a signed-out visitor cannot upload'
);

-- 29. Files can't be overwritten (no update rule): filtered, unchanged.
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ update storage.objects set name = %L || 'renamed.jpg' where bucket_id = 'listing-photos' and name = %L || 'upload-1.jpg' $$, :'a_dir', :'a_dir'),
  '29a. renaming a file raises no error'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'listing-photos' and name = :'a_dir' || 'upload-1.jpg'), 1,
  '29b. ...and the file is unchanged'
);

-- 30. Reading through the API: another provider can't list A's files, the
--     owner can. (Deleting depends on this: see the migration.)
select tests.authenticate_as(:'b');
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, '30a. another provider cannot list a provider''s files');
select tests.authenticate_as(:'a');
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 1, '30b. a provider can list their own files');

-- 31. Deleting: another provider can't; the owner and the admin can.
--     (The Storage API sets storage.allow_delete_query for its deletes.)
select tests.clear_authentication();
insert into storage.objects (bucket_id, name) values ('listing-photos', :'a_dir' || 'upload-6.jpg');
set local storage.allow_delete_query = 'true';
select tests.authenticate_as(:'b');
select lives_ok(
  format($$ delete from storage.objects where bucket_id = 'listing-photos' and name = %L || 'upload-1.jpg' $$, :'a_dir'),
  '31a. another provider deleting a file raises no error'
);
select tests.clear_authentication();
select is((select count(*)::int from storage.objects where name = :'a_dir' || 'upload-1.jpg'), 1, '31b. ...and the file is kept');
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ delete from storage.objects where bucket_id = 'listing-photos' and name = %L || 'upload-1.jpg' $$, :'a_dir'),
  '31c. a provider can delete their own file'
);
select tests.authenticate_as_admin(:'admin');
select lives_ok(
  format($$ delete from storage.objects where bucket_id = 'listing-photos' and name = %L || 'upload-6.jpg' $$, :'a_dir'),
  '31d. the admin can delete any file in the bucket'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from storage.objects where name in (:'a_dir' || 'upload-1.jpg', :'a_dir' || 'upload-6.jpg')), 0,
  '31e. ...and both files are gone'
);

select * from finish();
rollback;
