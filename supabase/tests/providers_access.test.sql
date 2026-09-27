-- Access rules on public.providers. Every allowed case is paired with the
-- blocked case next to it, so a rule that silently stops blocking fails here.
begin;
\ir _helpers/users.psql
select plan(21);

-- Three people: two would-be providers and the platform admin.
select tests.create_user('a@test.local') as a \gset
select tests.create_user('b@test.local') as b \gset
select tests.create_user('admin@test.local') as admin \gset

-- 1. A provider can create their own record.
select tests.authenticate_as(:'a');
select lives_ok(
  $$ insert into providers (owner_id, display_name, city) values (auth.uid(), 'A Tours', 'Atlanta') $$,
  '1. a user can create their own provider'
);

-- 2. ...but not one owned by someone else.
select tests.authenticate_as(:'b');
select throws_ok(
  format($$ insert into providers (owner_id, display_name) values (%L, 'Fake') $$, :'a'),
  '42501', 'new row violates row-level security policy for table "providers"',
  '2. a user cannot create a provider owned by someone else'
);

-- 3. Stripe fields can't be set on insert, even on your own record.
select throws_ok(
  $$ insert into providers (owner_id, display_name, stripe_payouts_enabled) values (auth.uid(), 'B Co', true) $$,
  '42501', 'permission denied for table providers',
  '3. a user cannot set Stripe fields when creating a provider'
);

-- 4. A provider sees only their own record.
insert into providers (owner_id, display_name) values (auth.uid(), 'B Co');
select is((select count(*)::int from providers), 1, '4. a provider sees only their own record');

-- 5. A provider can't rename someone else's business. RLS hides the row, so
--    the update succeeds and changes nothing; check the row as the runner.
select lives_ok(
  format($$ update providers set display_name = 'Hacked' where owner_id = %L $$, :'a'),
  '5a. updating another provider raises no error'
);
select tests.clear_authentication();
select is(
  (select display_name from providers where owner_id = :'a'), 'A Tours',
  '5b. ...and leaves their record unchanged'
);

-- 6. A provider can't mark themselves payout-ready.
select tests.authenticate_as(:'a');
select throws_ok(
  $$ update providers set stripe_payouts_enabled = true where owner_id = auth.uid() $$,
  '42501', 'permission denied for table providers',
  '6. a provider cannot set their own Stripe fields'
);

-- 7. A provider can't change their own status (e.g. lift a suspension).
select throws_ok(
  $$ update providers set status = 'active' where owner_id = auth.uid() $$,
  '42501', 'permission denied for table providers',
  '7. a provider cannot change their own status'
);

-- 8. A provider can edit their own profile fields.
select lives_ok(
  $$ update providers set display_name = 'A Food Tours' where owner_id = auth.uid() $$,
  '8a. a provider can rename their own business'
);
select is(
  (select display_name from providers where owner_id = auth.uid()), 'A Food Tours',
  '8b. ...and the new name is saved'
);

-- 9. Signed-out visitors can't read providers at all.
select tests.authenticate_as_anon();
select throws_ok(
  $$ select count(*) from providers $$,
  '42501', 'permission denied for table providers',
  '9. a signed-out visitor cannot read providers'
);

-- 10. The admin sees every provider.
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from providers), 2, '10. the admin sees all providers');

-- 11. One business per login.
select tests.authenticate_as(:'b');
select throws_ok(
  $$ insert into providers (owner_id, display_name) values (auth.uid(), 'B Two') $$,
  '23505', 'duplicate key value violates unique constraint "providers_owner_id_key"',
  '11. a user cannot create a second provider'
);

-- 12. The server (service role) writes the Stripe fields, and updated_at moves.
--     Backdate updated_at with triggers off, so the bump is visible within
--     this single transaction (now() is fixed for the whole transaction).
select tests.clear_authentication();
set local session_replication_role = replica;
update providers set updated_at = '2000-01-01' where owner_id = :'a';
set local session_replication_role = origin;

select tests.authenticate_as_service_role();
select lives_ok(
  format($$ update providers set stripe_account_id = 'acct_test', stripe_payouts_enabled = true where owner_id = %L $$, :'a'),
  '12a. the server can write Stripe fields'
);
select is(
  (select stripe_payouts_enabled from providers where owner_id = :'a'), true,
  '12b. ...and the change is saved'
);
select is(
  (select updated_at from providers where owner_id = :'a'), now(),
  '12c. ...and updated_at is refreshed by the trigger'
);

-- 13. Providers are never deleted, not even by their owner (suspend instead).
select tests.authenticate_as(:'a');
select throws_ok(
  $$ delete from providers where owner_id = auth.uid() $$,
  '42501', 'permission denied for table providers',
  '13a. a provider cannot delete their own record'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from providers where owner_id = :'a'), 1,
  '13b. ...and the record is still there'
);

-- 14. A login that owns a provider can't be deleted (suspend or anonymize the
--     provider first). A login without one still can. Run as the test runner,
--     since deleting logins is a server/dashboard action, not a user one.
select tests.clear_authentication();
select throws_ok(
  format($$ delete from auth.users where id = %L $$, :'a'),
  '23503', 'update or delete on table "users" violates foreign key constraint "providers_owner_id_fkey" on table "providers"',
  '14a. deleting a login that owns a provider fails'
);
select is(
  (select count(*)::int from providers where owner_id = :'a'), 1,
  '14b. ...and the provider is still there'
);
select tests.create_user('c@test.local') as c \gset
select lives_ok(
  format($$ delete from auth.users where id = %L $$, :'c'),
  '14c. a login without a provider can still be deleted'
);

select * from finish();
rollback;
