-- Access and status rules on public.listing_addresses and
-- public.listing_service_areas. Every allowed case is paired with the blocked
-- case next to it.
begin;
\ir _helpers/users.psql
select plan(41);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('a@test.local') as a \gset
select tests.create_user('b@test.local') as b \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into cities (slug, name, state, timezone) values ('decatur', 'Decatur', 'GA', 'America/New_York') returning id as dec \gset
insert into providers (owner_id, display_name, city_id) values (:'a', 'A Studio', :'atl') returning id as pa \gset
insert into providers (owner_id, display_name, city_id) values (:'b', 'B Mobile', :'atl') returning id as pb \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'zip', '30312') returning id as z312 \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Edgewood') returning id as edge \gset
insert into service_areas (city_id, kind, name, active) values (:'atl', 'neighborhood', 'Inman Park', false) returning id as inman \gset
insert into service_areas (city_id, kind, name) values (:'dec', 'neighborhood', 'Decatur Square') returning id as decsq \gset

-- A's studio Service and A's mobile Service start as drafts. B has a draft
-- studio Service and a live mobile Service.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pa', 'service', :'svc', :'atl', 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'o4w')
returning id as studio \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
values (:'pa', 'service', :'svc', :'atl', 'Haircut at your home', 'A mobile cut, wherever you are.', 6000, 'customer_location')
returning id as mobile \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pb', 'service', :'svc', :'atl', 'B studio haircut', 'Another provider''s studio service.', 5000, 'provider_location', :'o4w')
returning id as b_studio \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, status, published_at)
values (:'pb', 'service', :'svc', :'atl', 'B mobile haircut', 'Another provider''s mobile service.', 5500, 'customer_location', 'live', now())
returning id as b_mobile \gset

-- ---------------------------------------------------------------------------
-- ADDRESSES: who
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 1. A provider can add an address to their own draft...
select lives_ok(
  format($$ insert into listing_addresses (listing_id, line1, city, state, postal_code, instructions)
            values (%L, '123 Edgewood Ave', 'Atlanta', 'GA', '30312', 'Side entrance, ring twice') $$, :'studio'),
  '1. a provider can add an address to their own listing'
);

-- 2. ...but not to another provider's.
select throws_ok(
  format($$ insert into listing_addresses (listing_id, line1, city, state, postal_code)
            values (%L, '1 Fake St', 'Atlanta', 'GA', '30312') $$, :'b_studio'),
  '42501', 'new row violates row-level security policy for table "listing_addresses"',
  '2. a provider cannot add an address to another provider''s listing'
);

-- 3. Signed-out visitors can't read addresses at all.
select tests.authenticate_as_anon();
select throws_ok(
  $$ select count(*) from listing_addresses $$,
  '42501', 'permission denied for table listing_addresses',
  '3. a signed-out visitor cannot read listing addresses'
);

-- 4. Another provider can't read them either (rows are filtered out).
select tests.authenticate_as(:'b');
select is((select count(*)::int from listing_addresses), 0, '4. another provider cannot read a listing''s address');

-- 5. The owner and the admin can.
select tests.authenticate_as(:'a');
select is((select count(*)::int from listing_addresses), 1, '5a. a provider can read their own listing''s address');
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from listing_addresses), 1, '5b. the admin can read listing addresses');

-- 6. The owner can change the address of a draft; another provider can't.
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ update listing_addresses set line2 = 'Suite 2' where listing_id = %L $$, :'studio'),
  '6a. a provider can change their draft''s address'
);
select tests.authenticate_as(:'b');
select lives_ok(
  format($$ update listing_addresses set line1 = 'Hacked' where listing_id = %L $$, :'studio'),
  '6b. another provider changing an address raises no error'
);
select tests.clear_authentication();
select is((select line1 from listing_addresses where listing_id = :'studio'), '123 Edgewood Ave', '6c. ...and the address is unchanged');

-- 7. Addresses are validated.
select throws_ok(
  format($$ insert into listing_addresses (listing_id, line1, city, state, postal_code) values (%L, '9 Main St', 'Atlanta', 'GA', '3031') $$, :'mobile'),
  '23514', 'new row for relation "listing_addresses" violates check constraint "listing_addresses_postal_code_check"',
  '7a. a postal code is five digits, or five plus four'
);
select throws_ok(
  format($$ insert into listing_addresses (listing_id, line1, city, state, postal_code) values (%L, '9 Main St', 'Atlanta', 'Georgia', '30312') $$, :'mobile'),
  '23514', 'new row for relation "listing_addresses" violates check constraint "listing_addresses_state_check"',
  '7b. a state is a two-letter code'
);

-- 8. An address goes with its listing when a draft is deleted.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
values (:'pa', 'service', :'svc', :'atl', 'Draft with an address', 'A draft that will be deleted.', 1000, 'provider_location', :'o4w')
returning id as draft \gset
insert into listing_addresses (listing_id, line1, city, state, postal_code) values (:'draft', '5 Draft St', 'Atlanta', 'GA', '30312');
select tests.authenticate_as(:'a');
select lives_ok(format($$ delete from listings where id = %L $$, :'draft'), '8a. a provider deletes a never-published draft');
select tests.clear_authentication();
select is((select count(*)::int from listing_addresses where listing_id = :'draft'), 0, '8b. ...and its address goes with it');

-- ---------------------------------------------------------------------------
-- TRAVEL AREAS: who and which
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 9. A provider can add travel areas to their own "I come to you" Service...
select lives_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L), (%L, %L) $$,
         :'mobile', :'o4w', :'mobile', :'z312'),
  '9. a provider can add travel areas to their own mobile Service'
);

-- 10. ...but not to a provider-location Service.
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'studio', :'o4w'),
  '23514', 'Only "I come to you" Services have travel areas.',
  '10. a provider-location Service cannot have travel areas'
);

-- 11. Travel areas must be active and in the listing's city.
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'mobile', :'inman'),
  '23514', 'Choose one of the listed areas in the listing''s city.',
  '11a. a travel area must be active'
);
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'mobile', :'decsq'),
  '23514', 'Choose one of the listed areas in the listing''s city.',
  '11b. a travel area must be in the listing''s city'
);

-- 12. The same area can't be added twice.
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'mobile', :'o4w'),
  '23505', 'duplicate key value violates unique constraint "listing_service_areas_pkey"',
  '12. a travel area is listed once per listing'
);

-- 13. A provider can't add travel areas to another provider's Service.
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'b_mobile', :'o4w'),
  '42501', 'new row violates row-level security policy for table "listing_service_areas"',
  '13. a provider cannot add travel areas to another provider''s listing'
);

-- 14. Rows are added and removed, never edited.
select throws_ok(
  format($$ update listing_service_areas set service_area_id = %L where listing_id = %L $$, :'edge', :'mobile'),
  '42501', 'permission denied for table listing_service_areas',
  '14. a travel area row cannot be edited'
);

-- ---------------------------------------------------------------------------
-- LIVE
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
-- A listing needs a photo to go live (see listing_photos_access).
insert into listing_photos (listing_id, storage_path, position, alt_text) values
  (:'studio', :'pa' || '/' || :'studio' || '/' || gen_random_uuid() || '.jpg', 0, 'The studio chair and mirror'),
  (:'mobile', :'pa' || '/' || :'mobile' || '/' || gen_random_uuid() || '.jpg', 0, 'Scissors and a travel kit');
update listings set status = 'live', published_at = now() where id in (:'studio', :'mobile');

-- 15. Signed-out visitors see a live Service's travel areas, until it's hidden.
select tests.authenticate_as_anon();
select is((select count(*)::int from listing_service_areas where listing_id = :'mobile'), 2, '15a. a signed-out visitor sees a live Service''s travel areas');
select tests.clear_authentication();
update providers set status = 'suspended' where id = :'pa';
select tests.authenticate_as_anon();
select is((select count(*)::int from listing_service_areas where listing_id = :'mobile'), 0, '15b. ...and not once the listing is hidden');
select tests.clear_authentication();
update providers set status = 'active' where id = :'pa';

-- 16. Another provider can't remove A's travel areas (filtered: no error, kept).
select tests.authenticate_as(:'b');
select lives_ok(
  format($$ delete from listing_service_areas where listing_id = %L $$, :'mobile'),
  '16a. another provider removing travel areas raises no error'
);
select tests.clear_authentication();
select is((select count(*)::int from listing_service_areas where listing_id = :'mobile'), 2, '16b. ...and the travel areas are kept');

-- 17. On a live Service, travel areas can be added and removed...
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'mobile', :'edge'),
  '17a. a provider can add a travel area to a live Service'
);
select lives_ok(
  format($$ delete from listing_service_areas where listing_id = %L and service_area_id in (%L, %L) $$, :'mobile', :'z312', :'edge'),
  '17b. a provider can remove travel areas from a live Service'
);
select tests.clear_authentication();
select is((select count(*)::int from listing_service_areas where listing_id = :'mobile'), 1, '17c. ...and one travel area is left');

-- 18. ...except the last one, for anyone, the server included.
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ delete from listing_service_areas where listing_id = %L $$, :'mobile'),
  '23514', 'A live "I come to you" Service needs at least one travel area. Add another area first, or unlist it.',
  '18a. a provider cannot remove the last travel area from a live Service'
);
select tests.authenticate_as_service_role();
select throws_ok(
  format($$ delete from listing_service_areas where listing_id = %L $$, :'mobile'),
  '23514', 'A live "I come to you" Service needs at least one travel area. Add another area first, or unlist it.',
  '18b. nor can the server'
);

-- 19. A live listing's address is locked: no change, no removal.
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ update listing_addresses set line2 = 'Suite 3' where listing_id = %L $$, :'studio'),
  '23514', 'A live listing''s address can''t be changed. Unlist it first.',
  '19a. a provider cannot change a live listing''s address'
);
select throws_ok(
  format($$ delete from listing_addresses where listing_id = %L $$, :'studio'),
  '23514', 'A live listing''s address can''t be changed. Unlist it first.',
  '19b. a provider cannot remove a live listing''s address'
);
select throws_ok(
  format($$ insert into listing_addresses (listing_id, line1, city, state, postal_code) values (%L, '9 Main St', 'Atlanta', 'GA', '30312') $$, :'mobile'),
  '23514', 'A live listing''s address can''t be changed. Unlist it first.',
  '19c. a provider cannot add an address to a live listing'
);

-- 20. The server isn't limited by the address lock.
select tests.authenticate_as_service_role();
select lives_ok(
  format($$ update listing_addresses set line2 = 'Suite 4' where listing_id = %L $$, :'studio'),
  '20. the server can change a live listing''s address'
);

-- ---------------------------------------------------------------------------
-- SUBMITTED AND UNPUBLISHED: locked
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
update listings set status = 'submitted' where id in (:'studio', :'mobile');
select tests.authenticate_as(:'a');

-- 21. A submitted listing's address and travel areas are locked.
select throws_ok(
  format($$ update listing_addresses set line2 = 'Suite 5' where listing_id = %L $$, :'studio'),
  '23514', 'This listing''s address can''t be changed while it is submitted.',
  '21a. a provider cannot change a submitted listing''s address'
);
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'mobile', :'z312'),
  '23514', 'This listing''s travel areas can''t be changed while it is submitted.',
  '21b. a provider cannot add a travel area to a submitted listing'
);
select throws_ok(
  format($$ delete from listing_service_areas where listing_id = %L $$, :'mobile'),
  '23514', 'This listing''s travel areas can''t be changed while it is submitted.',
  '21c. a provider cannot remove a travel area from a submitted listing'
);

-- 22. The same while unpublished.
select tests.clear_authentication();
update listings set status = 'unpublished' where id in (:'studio', :'mobile');
select tests.authenticate_as(:'a');
select throws_ok(
  format($$ delete from listing_addresses where listing_id = %L $$, :'studio'),
  '23514', 'This listing''s address can''t be changed while it is unpublished.',
  '22a. a provider cannot remove an unpublished listing''s address'
);
select throws_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'mobile', :'z312'),
  '23514', 'This listing''s travel areas can''t be changed while it is unpublished.',
  '22b. a provider cannot add a travel area to an unpublished listing'
);

-- ---------------------------------------------------------------------------
-- REJECTED AND DRAFT AGAIN: free
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
update listings set status = 'rejected', rejection_reason = 'Add arrival details.' where id = :'studio';
update listings set status = 'draft' where id = :'mobile';
select tests.authenticate_as(:'a');

-- 23. A rejected listing's address can be changed again, ready to resubmit.
select lives_ok(
  format($$ update listing_addresses set instructions = 'Blue door, second floor' where listing_id = %L $$, :'studio'),
  '23. a provider can change a rejected listing''s address'
);

-- 24. A draft's travel areas are free again, down to none.
select lives_ok(
  format($$ delete from listing_service_areas where listing_id = %L $$, :'mobile'),
  '24a. a provider can remove every travel area from a draft'
);
select tests.clear_authentication();
select is((select count(*)::int from listing_service_areas where listing_id = :'mobile'), 0, '24b. ...and none are left');

select * from finish();
rollback;
