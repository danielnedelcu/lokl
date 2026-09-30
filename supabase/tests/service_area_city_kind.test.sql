-- Cities and towns as areas within a market: the admin can add one, the
-- public sees it like any other area, and providers can use it as a listing's
-- area and as a travel area. Unknown kinds are still refused.
begin;
\ir _helpers/users.psql
select plan(7);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('provider@test.local') as prov \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'prov', 'Metro Cuts', :'atl') returning id as p \gset
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset

-- ---------------------------------------------------------------------------
-- ADDING ONE (as the admin)
-- ---------------------------------------------------------------------------

select tests.authenticate_as_admin(:'admin');

-- 1. The admin can add a city or town within a market.
select lives_ok(
  format($$ insert into service_areas (city_id, kind, name) values (%L, 'city', 'Decatur') $$, :'atl'),
  '1. the admin can add a city or town as an area of a market'
);

-- 2. Other kinds are still refused.
select throws_ok(
  format($$ insert into service_areas (city_id, kind, name) values (%L, 'county', 'DeKalb') $$, :'atl'),
  '23514', 'new row for relation "service_areas" violates check constraint "service_areas_kind_check"',
  '2. an unknown kind of area is refused'
);

select tests.clear_authentication();
select id as decatur from service_areas where kind = 'city' and name = 'Decatur' \gset

-- ---------------------------------------------------------------------------
-- USING IT
-- ---------------------------------------------------------------------------

-- 3. Signed-out visitors see it like any other active area.
select tests.authenticate_as_anon();
select is((select kind from service_areas where id = :'decatur'), 'city',
  '3. a signed-out visitor sees an active city area');

-- 4. A provider can make it an "I come to you" Service's travel area...
select tests.authenticate_as(:'prov');
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
values (:'p', 'service', :'svc', :'atl', 'Haircut at your home', 'A classic cut wherever you are in the metro.', 6000, 'customer_location')
returning id as ls \gset
select lives_ok(
  format($$ insert into listing_service_areas (listing_id, service_area_id) values (%L, %L) $$, :'ls', :'decatur'),
  '4. a provider can travel to a city area'
);

-- 5. ...and an Experience's public area.
select lives_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
            values (%L, 'experience', %L, %L, 'Decatur square walk', 'The square, its history and its food.', 3000, 90, %L) $$,
         :'p', :'exp', :'atl', :'decatur'),
  '5. a city area can be a listing''s public area'
);

-- 6. A city area's name is unique within its market, like any other kind.
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  format($$ insert into service_areas (city_id, kind, name) values (%L, 'city', 'Decatur') $$, :'atl'),
  '23505', 'duplicate key value violates unique constraint "service_areas_city_id_kind_name_key"',
  '6. a city area''s name is unique within its market'
);

-- 7. Providers still can't add areas themselves.
select tests.authenticate_as(:'prov');
select throws_ok(
  format($$ insert into service_areas (city_id, kind, name) values (%L, 'city', 'Marietta') $$, :'atl'),
  '42501', 'new row violates row-level security policy for table "service_areas"',
  '7. a provider cannot add an area'
);

select * from finish();
rollback;
