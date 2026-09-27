-- Access rules on public.categories. Every allowed case is paired with the
-- blocked case next to it, so a rule that silently stops blocking fails here.
begin;
\ir _helpers/users.psql
select plan(22);

-- A regular signed-in user and the admin, plus one active and one inactive
-- category of each kind.
select tests.create_user('user@test.local') as usr \gset
select tests.create_user('admin@test.local') as admin \gset
insert into categories (kind, name, slug) values
  ('service', 'Hair and beauty', 'hair-and-beauty'),
  ('experience', 'Food tours', 'food-tours');
insert into categories (kind, name, slug, active) values
  ('service', 'Pet grooming', 'pet-grooming', false),
  ('experience', 'Night walks', 'night-walks', false);

-- ---------------------------------------------------------------------------
-- READING
-- ---------------------------------------------------------------------------

-- 1. Signed-out visitors see active categories only.
select tests.authenticate_as_anon();
select results_eq(
  $$ select slug from categories order by slug $$, $$ values ('food-tours'), ('hair-and-beauty') $$,
  '1. a signed-out visitor sees only active categories'
);

-- 2. The same for a signed-in user who isn't the admin.
select tests.authenticate_as(:'usr');
select results_eq(
  $$ select slug from categories order by slug $$, $$ values ('food-tours'), ('hair-and-beauty') $$,
  '2. a signed-in non-admin sees only active categories'
);

-- 3. The admin sees inactive categories too.
select tests.authenticate_as_admin(:'admin');
select results_eq(
  $$ select slug from categories order by slug $$,
  $$ values ('food-tours'), ('hair-and-beauty'), ('night-walks'), ('pet-grooming') $$,
  '3. the admin sees all categories, including inactive ones'
);

-- ---------------------------------------------------------------------------
-- WRITING
-- ---------------------------------------------------------------------------

-- 4. Signed-out visitors can't add a category.
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into categories (kind, name, slug) values ('service', 'Cleaning', 'cleaning') $$,
  '42501', 'permission denied for table categories',
  '4. a signed-out visitor cannot add a category'
);

-- 5. Neither can a signed-in non-admin...
select tests.authenticate_as(:'usr');
select throws_ok(
  $$ insert into categories (kind, name, slug) values ('service', 'Cleaning', 'cleaning') $$,
  '42501', 'new row violates row-level security policy for table "categories"',
  '5. a signed-in non-admin cannot add a category'
);

-- 6. ...but the admin can.
select tests.authenticate_as_admin(:'admin');
select lives_ok(
  $$ insert into categories (kind, name, slug) values ('service', 'Cleaning', 'cleaning') $$,
  '6. the admin can add a category'
);

-- 7. A non-admin's update is filtered out by RLS: no error, nothing changes.
select tests.authenticate_as(:'usr');
select lives_ok(
  $$ update categories set name = 'Hacked' where slug = 'hair-and-beauty' $$,
  '7a. a non-admin updating a category raises no error'
);
select tests.clear_authentication();
select is((select name from categories where slug = 'hair-and-beauty'), 'Hair and beauty', '7b. ...and the category is unchanged');

-- 8. The admin can rename, reorder and deactivate a category.
select tests.authenticate_as_admin(:'admin');
select lives_ok(
  $$ update categories set name = 'Home cleaning', sort_order = 5, active = false where slug = 'cleaning' $$,
  '8a. the admin can rename, reorder and deactivate a category'
);
select tests.clear_authentication();
select results_eq(
  $$ select name, sort_order, active from categories where slug = 'cleaning' $$,
  $$ values ('Home cleaning'::text, 5, false) $$,
  '8b. ...and the changes are saved'
);

-- 9. A category's kind is fixed once created, even for the admin.
select tests.authenticate_as_admin(:'admin');
select throws_ok(
  $$ update categories set kind = 'experience' where slug = 'cleaning' $$,
  '42501', 'permission denied for table categories',
  '9. the admin cannot change a category''s kind'
);

-- 10. Categories are never deleted, not even by the admin.
select throws_ok(
  $$ delete from categories where slug = 'cleaning' $$,
  '42501', 'permission denied for table categories',
  '10. the admin cannot delete a category'
);

-- ---------------------------------------------------------------------------
-- DATA RULES
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

-- 11. A slug is unique within its kind...
select throws_ok(
  $$ insert into categories (kind, name, slug) values ('service', 'Hair', 'hair-and-beauty') $$,
  '23505', 'duplicate key value violates unique constraint "categories_kind_slug_key"',
  '11a. a slug is unique within its kind'
);
-- ...but the same slug can be used by the other kind.
select lives_ok(
  $$ insert into categories (kind, name, slug) values ('experience', 'Hair and beauty', 'hair-and-beauty') $$,
  '11b. the same slug can be used for the other kind'
);

-- 12. Kind, name, slug and description are validated.
select throws_ok(
  $$ insert into categories (kind, name, slug) values ('product', 'Gifts', 'gifts') $$,
  '23514', 'new row for relation "categories" violates check constraint "categories_kind_check"',
  '12a. kind is service or experience'
);
select throws_ok(
  $$ insert into categories (kind, name, slug) values ('service', 'X', 'x') $$,
  '23514', 'new row for relation "categories" violates check constraint "categories_name_check"',
  '12b. a name has at least 2 characters'
);
select throws_ok(
  format($$ insert into categories (kind, name, slug) values ('service', %L, 'long-name') $$, repeat('a', 61)),
  '23514', 'new row for relation "categories" violates check constraint "categories_name_check"',
  '12c. a name has at most 60 characters'
);
select throws_ok(
  $$ insert into categories (kind, name, slug) values ('service', 'Gifts', 'Gifts & More') $$,
  '23514', 'new row for relation "categories" violates check constraint "categories_slug_check"',
  '12d. a slug is lowercase words joined by hyphens'
);
select throws_ok(
  format($$ insert into categories (kind, name, slug, description) values ('service', 'Gifts', 'gifts', %L) $$, repeat('a', 501)),
  '23514', 'new row for relation "categories" violates check constraint "categories_description_check"',
  '12e. a description has at most 500 characters'
);

-- 13. (id, kind) is unique, so listings can reference both together later.
select col_is_unique('public', 'categories', array['id', 'kind'], '13. (id, kind) is unique for the listings reference');

-- 14. updated_at moves on every change. Backdate it with triggers off, so the
--     bump is visible within this transaction (now() is fixed for all of it).
set local session_replication_role = replica;
update categories set updated_at = '2000-01-01' where slug = 'food-tours';
set local session_replication_role = origin;
update categories set sort_order = 1 where slug = 'food-tours';
select is((select updated_at from categories where slug = 'food-tours'), now(), '14. updated_at is refreshed on update');

-- 15. Default values: a new category is active and sorted first.
select results_eq(
  $$ select active, sort_order from categories where slug = 'hair-and-beauty' and kind = 'service' $$,
  $$ values (true, 0) $$,
  '15. a new category is active with sort order 0'
);

select * from finish();
rollback;
