-- A market's time zone (migration city_time_zones): required, and a real
-- zone name the database knows, so every time shown in a market's zone has
-- one (marketZone() only covers a city that wasn't read, never a bad zone).
begin;
\ir _helpers/users.psql
select plan(8);

select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset

select col_not_null('public', 'cities', 'timezone', '1. a city''s time zone is required');

select tests.authenticate_as_admin(:'admin');
select lives_ok($$ insert into cities (slug, name, state, timezone) values ('chicago', 'Chicago', 'IL', 'America/Chicago') $$,
  '2a. an admin adds a city with a real zone');
select throws_ok($$ insert into cities (slug, name, state, timezone) values ('olympus', 'Olympus', 'GA', 'Mars/Olympus') $$,
  '23514', null, '2b. a zone that only looks real is refused');
select throws_ok($$ insert into cities (slug, name, state, timezone) values ('eastern', 'Eastern', 'GA', 'America/Eastern') $$,
  '23514', null, '2c. ...so is a made-up one in a real region');
select throws_ok($$ insert into cities (slug, name, state, timezone) values ('est', 'Est', 'GA', 'EST') $$,
  '23514', null, '2d. an abbreviation isn''t a zone name');
select throws_ok(format($$ update cities set timezone = 'Mars/Olympus' where id = %L $$, :'atl'),
  '23514', null, '2e. an existing city can''t be changed to a zone that isn''t real');
select throws_ok($$ insert into cities (slug, name, state, timezone) values ('nozone', 'No Zone', 'GA', null) $$,
  '23502', null, '2f. nor left without one');
select tests.clear_authentication();
select is((select timezone from cities where id = :'atl'), 'America/New_York', '3. Atlanta keeps its zone');

select * from finish();
rollback;
