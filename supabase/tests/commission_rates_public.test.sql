-- Commission rates are public (migration commission_rates_public): anyone
-- reads the kind and the rate; signed-out visitors never see who changed a
-- rate or when, and can't change one.
begin;
\ir _helpers/users.psql
select plan(7);

select tests.create_user('cr-provider@test.local') as provider \gset

-- 1. A signed-out visitor.
select tests.authenticate_as_anon();
select results_eq($$ select kind, rate_bps from commission_rates order by kind $$,
  $$ values ('experience'::text, 2000), ('service'::text, 1200) $$, '1a. a visitor reads the kind and the rate of each');
select throws_ok($$ select updated_by from commission_rates $$, '42501', 'permission denied for table commission_rates',
  '1b. ...but not who changed it');
select throws_ok($$ select updated_at from commission_rates $$, '42501', 'permission denied for table commission_rates',
  '1c. ...or when');
select throws_ok($$ update commission_rates set rate_bps = 0 $$, '42501', 'permission denied for table commission_rates',
  '1d. ...and can''t change one');

-- 2. Signed in, as before.
select tests.authenticate_as(:'provider');
select is((select count(*)::int from commission_rates), 2, '2a. a signed-in user still reads them');
select lives_ok($$ update commission_rates set rate_bps = 0 $$, '2b. a provider''s update runs...');
select tests.clear_authentication();
select is((select rate_bps from commission_rates where kind = 'service'), 1200, '2c. ...and changes nothing (only admins may)');

select * from finish();
rollback;
