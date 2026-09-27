-- Access rules on public.listings. Every allowed case is paired with the
-- blocked case next to it, so a rule that silently stops blocking fails here.
begin;
\ir _helpers/users.psql
select plan(49);

-- ---------------------------------------------------------------------------
-- SETUP (as the test runner)
-- ---------------------------------------------------------------------------

-- Two providers in Atlanta, a user with no provider, and the admin.
select tests.create_user('a@test.local') as a \gset
select tests.create_user('b@test.local') as b \gset
select tests.create_user('admin@test.local') as admin \gset
select id as atl from cities where slug = 'atlanta' \gset
insert into cities (slug, name, state, timezone) values ('decatur', 'Decatur', 'GA', 'America/New_York');
select id as dec from cities where slug = 'decatur' \gset
insert into providers (owner_id, display_name, city_id) values (:'a', 'A Studio', :'atl') returning id as pa \gset
insert into providers (owner_id, display_name, city_id) values (:'b', 'B Tours', :'atl') returning id as pb \gset

-- Categories: one active of each kind, one inactive Service category.
insert into categories (kind, name, slug) values ('service', 'Hair and beauty', 'hair') returning id as svc \gset
insert into categories (kind, name, slug) values ('experience', 'Food tours', 'food') returning id as exp \gset
insert into categories (kind, name, slug, active) values ('service', 'Pet grooming', 'pets', false) returning id as svc_off \gset

-- Areas: two active and one inactive in Atlanta, one in Decatur.
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Old Fourth Ward') returning id as o4w \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'Edgewood') returning id as edge \gset
insert into service_areas (city_id, kind, name, active) values (:'atl', 'neighborhood', 'Inman Park', false) returning id as inman \gset
insert into service_areas (city_id, kind, name) values (:'dec', 'neighborhood', 'Decatur Square') returning id as decsq \gset

-- ---------------------------------------------------------------------------
-- CREATING LISTINGS
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 1. A provider can create a draft under their own provider record.
select lives_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Haircut at the studio', 'A classic cut, with a wash and style.', 4500, 'provider_location', %L) $$,
         :'pa', :'svc', :'atl', :'o4w'),
  '1. a provider can create a listing under their own provider'
);

-- 2. ...but not under someone else's.
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Fake listing here', 'Pretending to be another provider.', 100, 'provider_location', %L) $$,
         :'pb', :'svc', :'atl', :'o4w'),
  '42501', 'new row violates row-level security policy for table "listings"',
  '2. a provider cannot create a listing under another provider'
);

-- 3. A listing can't be created as live: status isn't writable at all.
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id, status)
            values (%L, 'service', %L, %L, 'Instant live listing', 'Trying to skip the publish checks.', 100, 'provider_location', %L, 'live') $$,
         :'pa', :'svc', :'atl', :'o4w'),
  '42501', 'permission denied for table listings',
  '3. a provider cannot create a listing with a status'
);

-- 4. A signed-out visitor can't create a listing.
select tests.authenticate_as_anon();
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Anonymous listing', 'Nobody signed in wrote this one.', 100, 'provider_location', %L) $$,
         :'pa', :'svc', :'atl', :'o4w'),
  '42501', 'permission denied for table listings',
  '4. a signed-out visitor cannot create a listing'
);

-- 5. The new listing is a draft, with a slug made from its title.
select tests.clear_authentication();
select id as l_draft from listings where title = 'Haircut at the studio' \gset
select is((select status from listings where id = :'l_draft'), 'draft', '5a. a new listing starts as a draft');
select matches(
  (select slug from listings where id = :'l_draft'), '^haircut-at-the-studio-[0-9a-f]{6}$',
  '5b. its slug is made from the title plus a short suffix'
);

-- ---------------------------------------------------------------------------
-- SHAPE RULES
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 6. A Service can't use an Experience category, and the reverse.
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Wrong category', 'A Service filed under Experiences.', 100, 'provider_location', %L) $$,
         :'pa', :'exp', :'atl', :'o4w'),
  '23503', 'insert or update on table "listings" violates foreign key constraint "listings_category_id_kind_fkey"',
  '6a. a Service cannot use an Experience category'
);
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
            values (%L, 'experience', %L, %L, 'Wrong category too', 'An Experience filed under Services.', 100, 60, %L) $$,
         :'pa', :'svc', :'atl', :'o4w'),
  '23503', 'insert or update on table "listings" violates foreign key constraint "listings_category_id_kind_fkey"',
  '6b. an Experience cannot use a Service category'
);

-- 7. An Experience needs a duration and no location mode.
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, area_id)
            values (%L, 'experience', %L, %L, 'Food tour, no time', 'A tour without a duration set.', 100, %L) $$,
         :'pa', :'exp', :'atl', :'o4w'),
  '23514', 'new row for relation "listings" violates check constraint "listings_experience_shape"',
  '7a. an Experience needs a duration'
);
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, location_mode, area_id)
            values (%L, 'experience', %L, %L, 'Food tour, at yours', 'A tour that claims to come to you.', 100, 60, 'customer_location', %L) $$,
         :'pa', :'exp', :'atl', :'o4w'),
  '23514', 'new row for relation "listings" violates check constraint "listings_experience_shape"',
  '7b. an Experience has no location mode'
);

-- 8. A Service needs a location mode.
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, area_id)
            values (%L, 'service', %L, %L, 'Haircut, somewhere', 'A service with no location mode.', 100, %L) $$,
         :'pa', :'svc', :'atl', :'o4w'),
  '23514', 'new row for relation "listings" violates check constraint "listings_service_shape"',
  '8. a Service needs a location mode'
);

-- 9. Provider-location Services and Experiences need an area; "I come to
--    you" Services don't (they list travel areas instead).
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
            values (%L, 'service', %L, %L, 'Studio cut, no area', 'A studio service with no area.', 100, 'provider_location') $$,
         :'pa', :'svc', :'atl'),
  '23514', 'new row for relation "listings" violates check constraint "listings_area_required"',
  '9a. a provider-location Service needs an area'
);
select lives_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode)
            values (%L, 'service', %L, %L, 'Haircut at your home', 'A mobile cut, wherever you are.', 6000, 'customer_location') $$,
         :'pa', :'svc', :'atl'),
  '9b. an "I come to you" Service needs no area'
);

-- ---------------------------------------------------------------------------
-- ACTIVE REFERENCES (checked on insert or change only)
-- ---------------------------------------------------------------------------

-- 10. Inactive category, inactive area, or an area in another city: blocked.
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Dog wash at the shop', 'Filed under an inactive category.', 100, 'provider_location', %L) $$,
         :'pa', :'svc_off', :'atl', :'o4w'),
  '23514', 'Choose one of the listed categories.',
  '10a. a listing cannot use an inactive category'
);
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Haircut in Inman Park', 'Placed in an inactive area.', 100, 'provider_location', %L) $$,
         :'pa', :'svc', :'atl', :'inman'),
  '23514', 'Choose one of the listed areas.',
  '10b. a listing cannot use an inactive area'
);
select throws_ok(
  format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id)
            values (%L, 'service', %L, %L, 'Haircut, wrong city', 'An Atlanta listing in a Decatur area.', 100, 'provider_location', %L) $$,
         :'pa', :'svc', :'atl', :'decsq'),
  '23514', 'Choose an area in the listing''s city.',
  '10c. a listing''s area must be in its city'
);
select throws_ok(
  format($$ update listings set city_id = %L where id = %L $$, :'dec', :'l_draft'),
  '23514', 'Choose an area in the listing''s city.',
  '10d. moving a listing to another city rechecks its area'
);

-- 11. A draft whose category is deactivated later can still be edited.
select tests.clear_authentication();
update categories set active = false where id = :'svc';
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ update listings set title = 'Haircut and style at the studio' where id = %L $$, :'l_draft'),
  '11. a listing whose category was deactivated later can still be edited'
);
select tests.clear_authentication();
update categories set active = true where id = :'svc';

-- ---------------------------------------------------------------------------
-- SERVER-ONLY FIELDS
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 12. A provider can't publish, submit or review their own listing directly.
select throws_ok(
  format($$ update listings set status = 'live' where id = %L $$, :'l_draft'),
  '42501', 'permission denied for table listings',
  '12a. a provider cannot set a listing live'
);
select throws_ok(
  format($$ update listings set published_at = now() where id = %L $$, :'l_draft'),
  '42501', 'permission denied for table listings',
  '12b. a provider cannot set published_at'
);
select throws_ok(
  format($$ update listings set rejection_reason = null, reviewed_at = now() where id = %L $$, :'l_draft'),
  '42501', 'permission denied for table listings',
  '12c. a provider cannot write review fields'
);

-- 13. Kind and slug are fixed after creation.
select throws_ok(
  format($$ update listings set kind = 'experience' where id = %L $$, :'l_draft'),
  '42501', 'permission denied for table listings',
  '13a. a provider cannot change a listing''s kind'
);
select throws_ok(
  format($$ update listings set slug = 'better-slug' where id = %L $$, :'l_draft'),
  '42501', 'permission denied for table listings',
  '13b. a provider cannot change a listing''s slug'
);

-- 14. The server (service role) can change status.
select tests.authenticate_as_service_role();
select lives_ok(
  format($$ update listings set status = 'live', published_at = now() where id = %L $$, :'l_draft'),
  '14. the server can publish a listing'
);

-- ---------------------------------------------------------------------------
-- VISIBILITY
-- ---------------------------------------------------------------------------

-- One listing of A's in every other status, written by the server.
select tests.clear_authentication();
select id as l_live from listings where id = :'l_draft' \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
values
  (:'pa', 'experience', :'exp', :'atl', 'Food tour: submitted', 'Waiting for the owner to review.', 3000, 90, :'o4w', 'submitted'),
  (:'pa', 'experience', :'exp', :'atl', 'Food tour: unpublished', 'Taken down by the owner.', 3000, 90, :'o4w', 'unpublished');
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, rejection_reason)
values (:'pa', 'experience', :'exp', :'atl', 'Food tour: rejected', 'Sent back with a reason.', 3000, 90, :'o4w', 'rejected', 'Add more detail.');
update listings set published_at = now() - interval '1 day' where title = 'Food tour: unpublished';
select id as l_sub from listings where title = 'Food tour: submitted' \gset
select id as l_unpub from listings where title = 'Food tour: unpublished' \gset
select id as l_rej from listings where title = 'Food tour: rejected' \gset
select id as l_mobile from listings where title = 'Haircut at your home' \gset

-- 15. Signed-out visitors see the live listing and nothing else.
select tests.authenticate_as_anon();
select results_eq(
  $$ select title from listings order by title $$, $$ values ('Haircut and style at the studio') $$,
  '15. a signed-out visitor sees only live listings'
);

-- 16. A live listing disappears when its provider, category or city goes inactive.
select tests.clear_authentication();
update providers set status = 'suspended' where id = :'pa';
select tests.authenticate_as_anon();
select is((select count(*)::int from listings), 0, '16a. a suspended provider''s listings are hidden');
select tests.clear_authentication();
update providers set status = 'active' where id = :'pa';
update categories set active = false where id = :'svc';
select tests.authenticate_as_anon();
select is((select count(*)::int from listings), 0, '16b. an inactive category''s listings are hidden');
select tests.clear_authentication();
update categories set active = true where id = :'svc';
update cities set active = false where id = :'atl';
select tests.authenticate_as_anon();
select is((select count(*)::int from listings), 0, '16c. an inactive city''s listings are hidden');
select tests.clear_authentication();
update cities set active = true where id = :'atl';
select tests.authenticate_as_anon();
select is((select count(*)::int from listings), 1, '16d. ...and they come back when reactivated');

-- 17. Another provider sees A's live listing, but none of A's others.
select tests.authenticate_as(:'b');
select results_eq(
  $$ select title from listings order by title $$, $$ values ('Haircut and style at the studio') $$,
  '17. another provider sees only a provider''s live listings'
);

-- 18. ...and can't change any of them (RLS hides the rows: no error, no change).
select lives_ok(
  format($$ update listings set price_cents = 1 where id = %L $$, :'l_live'),
  '18a. another provider updating a listing raises no error'
);
select tests.clear_authentication();
select is((select price_cents from listings where id = :'l_live'), 4500, '18b. ...and the listing is unchanged');

-- 19. The owner sees all their listings, in every status.
select tests.authenticate_as(:'a');
select is((select count(*)::int from listings), 5, '19. a provider sees all their own listings');

-- 20. The admin sees everything.
select tests.authenticate_as_admin(:'admin');
select is((select count(*)::int from listings), 5, '20. the admin sees all listings');

-- ---------------------------------------------------------------------------
-- EDITING BY STATUS
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 21. A live listing: price and description can change...
select lives_ok(
  format($$ update listings set price_cents = 5000, description = 'A classic cut, with a wash, style and finish.' where id = %L $$, :'l_live'),
  '21a. a provider can change a live listing''s price and description'
);
select is((select price_cents from listings where id = :'l_live'), 5000, '21b. ...and the change is saved');

-- 22. ...but nothing else.
select throws_ok(
  format($$ update listings set title = 'A different title entirely' where id = %L $$, :'l_live'),
  '23514', 'A live listing can only change its price and description. Unlist it to change anything else.',
  '22a. a provider cannot change a live listing''s title'
);
select throws_ok(
  format($$ update listings set area_id = %L where id = %L $$, :'edge', :'l_live'),
  '23514', 'A live listing can only change its price and description. Unlist it to change anything else.',
  '22b. a provider cannot move a live listing to another area'
);

-- 23. A submitted or unpublished listing can't be edited at all.
select throws_ok(
  format($$ update listings set price_cents = 2500 where id = %L $$, :'l_sub'),
  '23514', 'This listing can''t be edited while it is submitted.',
  '23a. a provider cannot edit a submitted listing'
);
select throws_ok(
  format($$ update listings set price_cents = 2500 where id = %L $$, :'l_unpub'),
  '23514', 'This listing can''t be edited while it is unpublished.',
  '23b. a provider cannot edit an unpublished listing'
);

-- 24. A rejected listing can be edited freely, ready to resubmit.
select lives_ok(
  format($$ update listings set title = 'Food tour: improved', area_id = %L where id = %L $$, :'edge', :'l_rej'),
  '24. a provider can edit a rejected listing'
);

-- 25. A rejected listing always has a reason (server writes).
select tests.authenticate_as_service_role();
select throws_ok(
  format($$ update listings set status = 'rejected', rejection_reason = null where id = %L $$, :'l_sub'),
  '23514', 'new row for relation "listings" violates check constraint "listings_rejection_reason"',
  '25. a listing cannot be rejected without a reason'
);

-- ---------------------------------------------------------------------------
-- DELETING
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'a');

-- 26. A never-published listing can be deleted...
select lives_ok(
  format($$ delete from listings where id = %L $$, :'l_mobile'),
  '26a. a provider can delete a never-published listing'
);
select tests.clear_authentication();
select is((select count(*)::int from listings where id = :'l_mobile'), 0, '26b. ...and it is gone');

-- 27. ...but one that has been live stays (RLS hides it from delete).
select tests.authenticate_as(:'a');
select lives_ok(
  format($$ delete from listings where id in (%L, %L) $$, :'l_live', :'l_unpub'),
  '27a. deleting a listing that has been live raises no error'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from listings where id in (:'l_live', :'l_unpub')), 2,
  '27b. ...and live or once-live listings are kept'
);

-- 28. Another provider can't delete A's never-published listings either.
select tests.authenticate_as(:'b');
select lives_ok(
  format($$ delete from listings where id = %L $$, :'l_rej'),
  '28a. another provider deleting a listing raises no error'
);
select tests.clear_authentication();
select is((select count(*)::int from listings where id = :'l_rej'), 1, '28b. ...and the listing is kept');

-- 29. updated_at moves on change. Backdate it with triggers off, so the bump
--     is visible within this transaction (now() is fixed for all of it).
set local session_replication_role = replica;
update listings set updated_at = '2000-01-01' where id = :'l_rej';
set local session_replication_role = origin;
update listings set price_cents = 3100 where id = :'l_rej';
select is((select updated_at from listings where id = :'l_rej'), now(), '29. updated_at is refreshed on update');

select * from finish();
rollback;
