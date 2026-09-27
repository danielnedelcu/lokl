-- Access rules on public.cities and public.service_areas. Every allowed case
-- is paired with the blocked case next to it, so a rule that silently stops
-- blocking fails here.
begin;
\ir _helpers/users.psql
select plan(26);

-- A regular signed-in user and the admin. Atlanta is seeded by the migration;
-- add an inactive city and one active and one inactive area.
select tests.create_user('user@test.local') as usr \gset
select tests.create_user('admin@test.local') as admin \gset
insert into cities (slug, name, state, timezone, active) values ('macon', 'Macon', 'GA', 'America/New_York', false);
insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'neighborhood', 'Old Fourth Ward');
insert into service_areas (city_id, kind, name, active) values ((select id from cities where slug = 'atlanta'), 'neighborhood', 'Edgewood', false);

-- ---------------------------------------------------------------------------
-- CITIES: reading
-- ---------------------------------------------------------------------------

-- 1. Signed-out visitors see active cities, not inactive ones.
select tests.authenticate_as_anon();
select results_eq(
  $$ select slug from cities order by slug $$, $$ values ('atlanta') $$,
  '1. a signed-out visitor sees only active cities'
);

-- 2. The same for a signed-in user who isn't the admin.
select tests.authenticate_as(:'usr');
select results_eq(
  $$ select slug from cities order by slug $$, $$ values ('atlanta') $$,
  '2. a signed-in non-admin sees only active cities'
);

-- 3. The admin sees inactive cities too.
select tests.authenticate_as_admin(:'admin');
select results_eq(
  $$ select slug from cities order by slug $$, $$ values ('atlanta'), ('macon') $$,
  '3. the admin sees all cities, including inactive ones'
);

-- ---------------------------------------------------------------------------
-- CITIES: writing
-- ---------------------------------------------------------------------------

-- 4. Signed-out visitors can't add a city.
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into cities (slug, name, state, timezone) values ('savannah', 'Savannah', 'GA', 'America/New_York') $$,
  '42501', 'permission denied for table cities',
  '4. a signed-out visitor cannot add a city'
);

-- 5. Neither can a signed-in non-admin...
select tests.authenticate_as(:'usr');
select throws_ok(
  $$ insert into cities (slug, name, state, timezone) values ('savannah', 'Savannah', 'GA', 'America/New_York') $$,
  '42501', 'new row violates row-level security policy for table "cities"',
  '5. a signed-in non-admin cannot add a city'
);

-- 6. ...but the admin can.
select tests.authenticate_as_admin(:'admin');
select lives_ok(
  $$ insert into cities (slug, name, state, timezone) values ('savannah', 'Savannah', 'GA', 'America/New_York') $$,
  '6. the admin can add a city'
);

-- 7. A non-admin's update is filtered out by RLS: no error, nothing changes.
select tests.authenticate_as(:'usr');
select lives_ok(
  $$ update cities set name = 'Hacked' where slug = 'atlanta' $$,
  '7a. a non-admin updating a city raises no error'
);
select tests.clear_authentication();
select is((select name from cities where slug = 'atlanta'), 'Atlanta', '7b. ...and the city is unchanged');

-- 8. The admin can change a city, e.g. deactivate it.
select tests.authenticate_as_admin(:'admin');
select lives_ok(
  $$ update cities set active = false where slug = 'savannah' $$,
  '8a. the admin can deactivate a city'
);
select tests.clear_authentication();
select is((select active from cities where slug = 'savannah'), false, '8b. ...and the change is saved');

-- 9. Cities are never deleted, not even by the admin.
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  $$ delete from cities where slug = 'savannah' $$,
  '42501', 'permission denied for table cities',
  '9. the admin cannot delete a city'
);

-- 10. The city data is validated.
select tests.clear_authentication();
select throws_ok(
  $$ insert into cities (slug, name, state, timezone) values ('athens', 'Athens', 'ga', 'America/New_York') $$,
  '23514', 'new row for relation "cities" violates check constraint "cities_state_check"',
  '10a. a state must be a two-letter uppercase code'
);
select throws_ok(
  $$ insert into cities (slug, name, state, timezone) values ('Athens GA', 'Athens', 'GA', 'America/New_York') $$,
  '23514', 'new row for relation "cities" violates check constraint "cities_slug_check"',
  '10b. a slug must be lowercase words joined by hyphens'
);
select throws_ok(
  $$ insert into cities (slug, name, state, timezone) values ('atlanta', 'Atlanta Two', 'GA', 'America/New_York') $$,
  '23505', 'duplicate key value violates unique constraint "cities_slug_key"',
  '10c. a slug is unique'
);

-- ---------------------------------------------------------------------------
-- SERVICE AREAS
-- ---------------------------------------------------------------------------

-- 11. Signed-out visitors see active areas, not inactive ones.
select tests.authenticate_as_anon();
select results_eq(
  $$ select name from service_areas order by name $$, $$ values ('Old Fourth Ward') $$,
  '11. a signed-out visitor sees only active service areas'
);

-- 12. The admin sees inactive areas too.
select tests.authenticate_as_admin(:'admin');
select results_eq(
  $$ select name from service_areas order by name $$, $$ values ('Edgewood'), ('Old Fourth Ward') $$,
  '12. the admin sees all service areas, including inactive ones'
);

-- 13. Signed-out visitors can't add an area.
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'zip', '30312') $$,
  '42501', 'permission denied for table service_areas',
  '13. a signed-out visitor cannot add a service area'
);

-- 14. Neither can a signed-in non-admin...
select tests.authenticate_as(:'usr');
select throws_ok(
  $$ insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'zip', '30312') $$,
  '42501', 'new row violates row-level security policy for table "service_areas"',
  '14. a signed-in non-admin cannot add a service area'
);

-- 15. ...but the admin can.
select tests.authenticate_as_admin(:'admin');
select lives_ok(
  $$ insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'zip', '30312') $$,
  '15. the admin can add a service area'
);

-- 16. A non-admin's update is filtered out: no error, nothing changes.
select tests.authenticate_as(:'usr');
select lives_ok(
  $$ update service_areas set active = false where name = 'Old Fourth Ward' $$,
  '16a. a non-admin updating a service area raises no error'
);
select tests.clear_authentication();
select is((select active from service_areas where name = 'Old Fourth Ward'), true, '16b. ...and the area is unchanged');

-- 17. Areas are never deleted, not even by the admin.
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  $$ delete from service_areas where name = 'Edgewood' $$,
  '42501', 'permission denied for table service_areas',
  '17. the admin cannot delete a service area'
);

-- 18. Area data is validated.
select tests.clear_authentication();
select throws_ok(
  $$ insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'neighborhood', 'Old Fourth Ward') $$,
  '23505', 'duplicate key value violates unique constraint "service_areas_city_id_kind_name_key"',
  '18a. an area name is unique per city and kind'
);
select throws_ok(
  $$ insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'zip', '3031') $$,
  '23514', 'new row for relation "service_areas" violates check constraint "service_areas_check"',
  '18b. a zip area must be a five-digit zip code'
);
select throws_ok(
  $$ insert into service_areas (city_id, kind, name) values ((select id from cities where slug = 'atlanta'), 'county', 'Fulton') $$,
  '23514', 'new row for relation "service_areas" violates check constraint "service_areas_kind_check"',
  '18c. kind is neighborhood or zip'
);

-- 19. A city that areas point to can't be removed, even outside the
--     privilege rules (restrict).
select throws_ok(
  $$ delete from cities where slug = 'atlanta' $$,
  '23503', 'update or delete on table "cities" violates foreign key constraint "service_areas_city_id_fkey" on table "service_areas"',
  '19. a city with service areas cannot be deleted'
);

select * from finish();
rollback;
