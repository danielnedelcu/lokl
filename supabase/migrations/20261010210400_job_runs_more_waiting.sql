-- Whether a job run left work for the next run (truncation sweep,
-- 2026-10-10). Jobs work in batches (200 or 500 rows); when a batch is full
-- there may be more, which waits for the next run. The admin's "needs
-- attention" list shows it.
--
-- job_runs is append-only (append_only_logs); a new column with a default
-- is fine. The server writes it when it logs the run (its table grant covers
-- new columns); admins read it (the same).

alter table public.job_runs add column more_waiting boolean not null default false;

comment on column public.job_runs.more_waiting is
  'True when a batch was full, so more rows may be waiting for the next run. Written by the job route.';
