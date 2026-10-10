-- job_runs.more_waiting (migration job_runs_more_waiting): the server logs
-- whether a batch was full; the log stays append-only.
begin;
\ir _helpers/users.psql
select plan(4);

select tests.authenticate_as_service_role();
select lives_ok($$ insert into job_runs (job, started_at, checked, more_waiting) values ('pay-out', now(), 200, true) $$, '1a. the server logs a full batch');
select lives_ok($$ insert into job_runs (job, started_at) values ('expire-requests', now()) $$, '1b. ...and one that wasn''t');
select tests.clear_authentication();
select is((select array_agg(more_waiting order by job) from job_runs where job in ('pay-out', 'expire-requests')), array[false, true], '1c. not full is the default');
select tests.authenticate_as_service_role();
select throws_ok($$ update job_runs set more_waiting = false where job = 'pay-out' $$, '23514', null, '2. it can''t be changed afterwards (append-only)');
select tests.clear_authentication();

select * from finish();
rollback;
