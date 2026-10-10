-- The admin's AI drafting cost (migration admin_ai_draft_cost): counted and
-- added up by the database, past the API's 1,000 rows; only admins see it.
begin;
\ir _helpers/users.psql
select plan(5);

select tests.create_user('admin@test.local') as admin \gset
select tests.create_user('someone@test.local') as someone \gset
insert into guide_ai_drafts (topic, model, cost_usd, created_at)
select 'Topic ' || g, 'test-model', 0.0125, now() - interval '1 hour' from generate_series(1, 1200) g;
insert into guide_ai_drafts (topic, model, cost_usd, created_at) values ('Last month', 'test-model', 5, now() - interval '40 days');

select tests.authenticate_as_admin(:'admin');
select is((admin_ai_draft_cost(now() - interval '1 day') ->> 'count')::int, 1200, '1a. an admin: all 1,200 drafts since the time are counted');
select is((admin_ai_draft_cost(now() - interval '1 day') ->> 'cost_usd')::numeric, 15.0000, '1b. ...and their cost added up (not last month''s)');
select tests.clear_authentication();

select tests.authenticate_as(:'someone');
select is(admin_ai_draft_cost(now() - interval '1 day'), '{"count": 0, "cost_usd": 0}'::jsonb, '2a. anyone else gets nothing (they can''t read the drafts)');
select tests.clear_authentication();
select tests.authenticate_as_anon();
select throws_ok($$ select admin_ai_draft_cost(now()) $$, '42501', 'permission denied for function admin_ai_draft_cost', '2b. a visitor can''t call it');
select tests.clear_authentication();
select tests.authenticate_as_service_role();
select throws_ok($$ select admin_ai_draft_cost(now()) $$, '42501', 'permission denied for function admin_ai_draft_cost', '2c. nor the server key');
select tests.clear_authentication();

select * from finish();
rollback;
