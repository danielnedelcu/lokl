-- Provider profiles (migration provider_profiles): what visitors can read,
-- what a provider can write, the contact-details rule, the profile address,
-- the provider-photos bucket, and the admin's removal of content that
-- breaks the rules.
begin;
\ir _helpers/users.psql
select plan(45);

select tests.create_user('admin@test.local') as admin \gset
-- The function's second safeguard checks the account's admin role, as set by hand in production.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = :'admin';
select tests.create_user('peach@test.local') as owner1 \gset
select tests.create_user('second@test.local') as owner2 \gset
select tests.create_user('quiet@test.local') as owner3 \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled)
values (:'owner1', 'Peach Tours', :'atl', 'acct_test_peach', true, true) returning id as p1 \gset
-- The same name: the second gets a numbered address.
insert into providers (owner_id, display_name, city_id) values (:'owner2', 'Peach Tours!', :'atl') returning id as p2 \gset
-- No live listing: no public profile.
insert into providers (owner_id, display_name, city_id) values (:'owner3', 'Quiet Walks', :'atl') returning id as p3 \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as cat \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values (:'p1', 'experience', :'cat', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'o4w', 'submitted') returning id as l1 \gset
insert into listing_photos (listing_id, storage_path, position, alt_text) values (:'l1', :'p1' || '/' || :'l1' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
update listings set status = 'live', published_at = now() where id = :'l1';
update providers set headline = 'Food walks through Atlanta''s oldest neighborhoods', bio = 'We started in 2019.',
  avatar_path = :'p1' || '/avatar-a.webp', avatar_small_path = :'p1' || '/avatar-a-small.webp',
  cover_path = :'p1' || '/cover-a.webp', cover_card_path = :'p1' || '/cover-a-card.webp' where id = :'p1';

-- 1. The profile address.
select is((select slug from providers where id = :'p1'), 'peach-tours', '1a. a new provider gets an address from the business name');
select is((select slug from providers where id = :'p2'), 'peach-tours-2', '1b. a taken address is numbered');
update providers set display_name = 'Peach Tours Atlanta' where id = :'p1';
select is((select slug from providers where id = :'p1'), 'peach-tours', '1c. renaming the business keeps the address (fixed for now)');
select tests.create_user('fourth@test.local') as owner4 \gset
insert into providers (owner_id, display_name, city_id, slug) values (:'owner4', 'Garden Club', :'atl', 'peach-tours-3');
select is((select slug from providers where owner_id = :'owner4'), 'garden-club', '1d. an address given on insert is replaced by the one made from the name');
-- A signed-in user creates their business, named like ones they can't see.
select tests.create_user('fifth@test.local') as owner5 \gset
select tests.authenticate_as(:'owner5');
select lives_ok(format($$ insert into providers (owner_id, display_name, city_id) values (%L, 'Peach Tours', %L) $$, :'owner5', :'atl'),
  '1e. a signed-in user can create a business named like one they can''t see');
select tests.clear_authentication();
select is((select slug from providers where owner_id = :'owner5'), 'peach-tours-3', '1f. ...and gets the next free address');

-- 2. The contact-details rule (the same samples as packages/types' unit test).
select ok(has_contact_details('Call me at 404-555-0182'), '2a. a phone number is contact details');
select ok(has_contact_details('+1 404 555 0182'), '2b. ...with a country code');
select ok(has_contact_details('email me: sam@peachtours.com'), '2c. an email');
select ok(has_contact_details('see peachtours.com'), '2d. a web address');
select ok(has_contact_details('www.peachtours'), '2e. a www. address');
select ok(not has_contact_details('Food walks since 2019 in Old Fourth Ward'), '2f. a year isn''t');
select ok(not has_contact_details('Tours at 10:00 AM and 2:30 PM'), '2g. times aren''t');
select ok(not has_contact_details('Over 1,500 happy guests'), '2h. a number with a comma isn''t');
select ok(not has_contact_details('St. Louis-born, Atlanta-raised'), '2i. ordinary punctuation isn''t');
select ok(has_contact_details('Guiding tours 2015-2020'), '2i2. a year range written with a hyphen reads as a phone number (the message says how to write it)');
select ok(not has_contact_details('Guiding tours 2015 to 2020'), '2i3. ...written with "to", it''s fine');
select throws_ok(format($$ update providers set headline = 'Book at peachtours.com' where id = %L $$, :'p1'), '23514', null, '2j. a headline with contact details is refused');
select throws_ok(format($$ update providers set bio = 'Text 404 555 0182 to book.' where id = %L $$, :'p1'), '23514', null, '2k. a bio with contact details is refused');
select throws_ok(format($$ update providers set headline = %L where id = %L $$, repeat('a', 81), :'p1'), '23514', null, '2l. a headline over 80 characters is refused');

-- 3. Photos: in the provider's own folder, in pairs.
select throws_ok(format($$ update providers set avatar_path = %L, avatar_small_path = %L where id = %L $$, :'p2' || '/x.webp', :'p2' || '/x-small.webp', :'p1'),
  '23514', null, '3a. a photo path in another provider''s folder is refused');
select throws_ok(format($$ update providers set avatar_small_path = null where id = %L $$, :'p1'), '23514', null, '3b. a photo without its small copy is refused');

-- 4. What a signed-out visitor can read.
set local role anon;
select is((select headline from providers where id = :'p1'), 'Food walks through Atlanta''s oldest neighborhoods', '4a. visitors read a bookable provider''s headline');
select is((select array[bio, slug, avatar_path, cover_card_path] from providers where id = :'p1'),
  array['We started in 2019.', 'peach-tours', :'p1' || '/avatar-a.webp', :'p1' || '/cover-a-card.webp'], '4b. ...bio, address and photos');
select ok((select created_at is not null and city_id = :'atl' from providers where id = :'p1'), '4c. ...when they joined and their market');
select throws_ok(format($$ select stripe_account_id from providers where id = %L $$, :'p1'), '42501', null, '4d. never the Stripe account');
select throws_ok(format($$ select status from providers where id = %L $$, :'p1'), '42501', null, '4e. never the status');
select throws_ok(format($$ select owner_id from providers where id = %L $$, :'p1'), '42501', null, '4f. never the owner');
select is((select count(*)::int from providers where id = :'p3'), 0, '4g. a provider with no live listing has no public profile');
reset role;
update providers set status = 'suspended' where id = :'p1';
set local role anon;
select is((select count(*)::int from providers where id = :'p1'), 0, '4h. a suspended provider has no public profile');
reset role;
update providers set status = 'active' where id = :'p1';

-- 5. What a provider can write.
select tests.authenticate_as(:'owner1');
update providers set headline = 'Walks and tastings', bio = 'Small groups, good food.' where id = :'p1';
select is((select headline from providers where id = :'p1'), 'Walks and tastings', '5a. a provider edits their own headline and bio');
update providers set headline = 'Taken over' where id = :'p2';
select tests.clear_authentication();
select is((select headline from providers where id = :'p2'), null, '5b. ...never another provider''s');
select tests.authenticate_as(:'owner1');
select throws_ok(format($$ update providers set slug = 'mine' where id = %L $$, :'p1'), '42501', null, '5c. a provider can''t change their address');
select throws_ok(format($$ update providers set status = 'active' where id = %L $$, :'p1'), '42501', null, '5d. ...or their status');

-- 6. The provider-photos bucket.
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('provider-photos', %L || '/avatar-1.webp') $$, :'p1'),
  '6a. a provider uploads into their own folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('provider-photos', %L || '/avatar-2.webp') $$, :'p2'),
  '42501', 'new row violates row-level security policy for table "objects"', '6b. ...not into another provider''s');
select tests.authenticate_as(:'owner2');
-- (Deletes reach only the files a caller can read, so this also means they
-- can't delete them; storage refuses direct deletes in SQL, so that part is
-- covered by the Storage API in the end-to-end tests.)
select is((select count(*)::int from storage.objects where bucket_id = 'provider-photos'), 0, '6c. another provider can''t list (or so delete) them');
select tests.clear_authentication();
set local role anon;
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('provider-photos', %L || '/x.webp') $$, :'p1'),
  '42501', null, '6e. visitors can''t upload');
reset role;

-- 7. Removing content that breaks the rules: the server, for an admin.
select tests.authenticate_as_admin(:'admin');
select throws_ok(format($$ select admin_remove_provider_profile_content(%L, %L, array['bio'], 'contact_details', 'A phone number in the bio.', null) $$, :'p1', :'admin'),
  '42501', null, '7a. even an admin can''t call it from the browser (the server does)');
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_remove_provider_profile_content(%L, %L, array['bio'], 'contact_details', 'A phone number in the bio.', null) $$, :'p1', :'owner2'),
  '42501', null, '7b. an id that isn''t an admin''s is refused');
select throws_ok(format($$ select admin_remove_provider_profile_content(%L, %L, array['bio'], null, 'A phone number in the bio.', null) $$, :'p1', :'admin'),
  '23514', 'Choose the profile rule this content breaks.', '7c0. a removal must name the rule it breaks');
select is(admin_remove_provider_profile_content(:'p1', :'admin', array['avatar', 'bio'], 'contact_details', 'A phone number in the bio.', 'Please keep contact details out of your profile.'),
  array[:'p1' || '/avatar-a.webp', :'p1' || '/avatar-a-small.webp'], '7c. it returns the removed photo''s files, to delete');
select ok((select avatar_path is null and avatar_small_path is null and bio is null and headline = 'Walks and tastings' and cover_path is not null from providers where id = :'p1'),
  '7d. only what was chosen is removed');
select is((select action || ':' || reason from admin_actions where target_id = :'p1' order by created_at desc limit 1),
  'remove_profile_content:A phone number in the bio.', '7e. the admin action is logged with its reason');
select is((select kind || ':' || rule || ':' || array_to_string(removed, ',') || ':' || message from provider_emails where provider_id = :'p1'),
  'provider_profile_edited:contact_details:avatar,bio:Please keep contact details out of your profile.', '7f. an email to the provider is queued: what, which rule, the message');

select * from finish();
rollback;
