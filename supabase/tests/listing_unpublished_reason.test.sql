-- The unpublish reason: required while unpublished, cleared on restore,
-- readable by the listing's provider but never writable by them.
begin;
\ir _helpers/users.psql
select plan(10);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner): a live Experience of A's
-- ---------------------------------------------------------------------------

select tests.create_user('a@test.local') as a \gset
select tests.create_user('b@test.local') as b \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into providers (owner_id, display_name, city_id) values (:'a', 'A Tours', :'atl') returning id as pa \gset
insert into providers (owner_id, display_name, city_id) values (:'b', 'B Tours', :'atl');
insert into categories (kind, name, slug) values ('experience', 'Food and drink', 'food') returning id as exp \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'pa', 'experience', :'exp', :'atl', 'Taco crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 150, :'o4w')
returning id as la \gset
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'la', :'pa' || '/' || :'la' || '/' || gen_random_uuid() || '.jpg', 0, 'Tacos on a picnic table');
update listings set status = 'live', published_at = now() where id = :'la';

select 'The photos show a different business, so this can''t stay up.' as reason \gset

-- ---------------------------------------------------------------------------
-- UNPUBLISHING (as the server)
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

-- 1. Unpublishing needs a reason...
select throws_ok(
  format($$ update listings set status = 'unpublished' where id = %L $$, :'la'),
  '23514', 'new row for relation "listings" violates check constraint "listings_unpublished_reason"',
  '1. a listing cannot be unpublished without a reason'
);
-- 2. ...of at least 10 characters...
select throws_ok(
  format($$ update listings set status = 'unpublished', unpublished_reason = 'No.' where id = %L $$, :'la'),
  '23514', 'new row for relation "listings" violates check constraint "listings_unpublished_reason_check"',
  '2. the reason needs at least 10 characters'
);
-- 3. ...and a live listing can't carry one.
select throws_ok(
  format($$ update listings set unpublished_reason = %L where id = %L $$, :'reason', :'la'),
  '23514', 'new row for relation "listings" violates check constraint "listings_unpublished_reason"',
  '3. a live listing cannot have an unpublish reason'
);
-- 4. With a reason, unpublishing works.
select lives_ok(
  format($$ update listings set status = 'unpublished', unpublished_reason = %L where id = %L $$, :'reason', :'la'),
  '4. the server can unpublish a listing with a reason'
);

-- ---------------------------------------------------------------------------
-- WHO READS AND WRITES IT
-- ---------------------------------------------------------------------------

-- 5. The provider reads the reason...
select tests.authenticate_as(:'a');
select is((select unpublished_reason from listings where id = :'la'), :'reason',
  '5. the provider can read why their listing was taken down');

-- 6. ...but can't change or clear it.
select throws_ok(
  format($$ update listings set unpublished_reason = 'I fixed everything, honestly.' where id = %L $$, :'la'),
  '42501', 'permission denied for table listings',
  '6a. the provider cannot change the reason'
);
select throws_ok(
  format($$ update listings set unpublished_reason = null where id = %L $$, :'la'),
  '42501', 'permission denied for table listings',
  '6b. the provider cannot clear the reason'
);

-- 7. Another provider can't read it.
select tests.authenticate_as(:'b');
select is((select count(*)::int from listings where id = :'la'), 0,
  '7. another provider cannot read the listing or its reason');

-- ---------------------------------------------------------------------------
-- RESTORING (as the server)
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

-- 8. Restoring must clear the reason...
select throws_ok(
  format($$ update listings set status = 'live' where id = %L $$, :'la'),
  '23514', 'new row for relation "listings" violates check constraint "listings_unpublished_reason"',
  '8. a listing cannot be restored with its old reason'
);
-- 9. ...and with it cleared, restoring works.
select lives_ok(
  format($$ update listings set status = 'live', unpublished_reason = null where id = %L $$, :'la'),
  '9. the server can restore a listing, clearing the reason'
);

select * from finish();
rollback;
