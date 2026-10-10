---
name: marketplace-migrations
description: Write and test Supabase/Postgres migrations for this marketplace in its house style — RLS row policies plus column grants, server-only columns, is_admin(), explicit delete behaviour, comment-on documentation, and pgTAP access-rule tests covering both allowed and blocked cases. Use whenever a task touches supabase/migrations/ or supabase/tests/, or adds or changes a table, column, policy, grant, trigger or database function — including "add a table for X", "store Y", "only admins can…", "providers shouldn't be able to…", or a query unexpectedly blocked by RLS. Also use before running npm run db:push.
---

# Marketplace — migrations

The database is where access rules are enforced. Page guards and route checks
exist too, but a bug there must not be able to expose or change data it
shouldn't. A migration here extends that guarantee, and its tests are what
prove the guarantee still holds.

The patterns below come from `supabase/migrations/20260927000000_providers.sql`
and `supabase/tests/providers_access.test.sql`, the only migration and test
file so far, plus rules the owner has set. Follow them until more exist.

## Rules that are never skipped

1. **`npm run db:push` needs the owner's explicit go-ahead, every time.** It
   applies to the hosted database and can't be undone. Write the migration,
   run the tests, show the diff, and wait. Never run it as the natural last
   step of a task, or because the change looks obviously right.
2. **Access-rule changes ship with tests covering both allowed and blocked
   cases.** Any new or changed policy, grant or revoke, or any check that
   decides who can do what, gets a pgTAP test. The test shows the permitted
   action succeeding and the forbidden one failing.
3. **`db:test` runs before `db:push`.** The `db:push` script chains it, so a
   failing test stops the push. Don't bypass it by running `supabase db push`
   directly.
4. **Never edit a migration once it's pushed to the hosted database.** Fix it
   with a new migration. A migration that has only run locally can still be
   edited; the providers migration stays editable until the first push.
5. **Every table's migration states its delete behaviour.** Tables that
   bookings, payments or payouts point to are deactivated, never deleted.
   For every other table, the migration says explicitly what deleting does and
   who may do it, and its design doc gives the reason.

## Workflow

```bash
npx supabase migration new <snake_case_name>   # creates supabase/migrations/<timestamp>_<name>.sql
# write the SQL; add or extend supabase/tests/<name>.test.sql
npm run db:test                                # local only: reset from migrations, run pgTAP
# show the migration + test diff, wait for the go-ahead
npm run db:push                                # db:test → hosted push → db:types → db:docs
```

`db:test` needs Docker. It wipes and rebuilds the **local** database every run.

Design docs go in `docs/design/` (not created yet). A table's delete reasoning
lives there (rule 5).

## Two kinds of comment

- **`comment on table / column / policy / function`** says what a thing
  *means*. These surface in the Supabase dashboard and in the generated
  `docs/schema/`. Write one for every table and policy, and for columns and
  functions whose names under-sell them.
- **`--` comments** say *why the migration is written this way*: why a
  privilege is revoked, why a call is wrapped in `(select …)`.

The providers migration opens with a `--` header saying what the table is and
what's deliberately deferred. `-- ---` dividers with SHOUTED section names split
it into SHARED HELPERS, TABLE, ROW ACCESS (RLS), and COLUMN ACCESS AND DELETE
BEHAVIOUR.

## Shared helpers

These are defined once, in the providers migration, with `create or replace function`:

- `public.is_admin()`: `language sql stable`, returns
  `coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)`.
  Use it in every admin policy; don't re-inline the JWT check.
- `public.set_updated_at()`: a plpgsql trigger function setting `new.updated_at = now()`.

## Table shape

```sql
create table public.<name> (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  ...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.<name> is '<what a row is; its delete behaviour>';
comment on column public.<name>.<col> is '<what it means; who writes it>';

create trigger <name>_set_updated_at
  before update on public.<name>
  for each row execute function public.set_updated_at();
```

- Table names are schema-qualified (`public.providers`).
- Fixed value sets are `text` plus a `check (col in (...))` constraint.
- Free-text columns carry length checks.
- Groups of columns sit under a short `--` note saying who writes them.
- `providers.owner_id` uses `on delete restrict`: a login that owns a
  provider can't be deleted until the provider is suspended or anonymized.
  Deleting a login must not silently remove the provider.
- The table comment states the delete behaviour. For providers that's "Never
  deleted: bookings and payouts will point here, so a provider is suspended instead."

## Access rules: two layers

**Row policies** decide which rows. Enable RLS right after the table, scope
each policy `to authenticated`, name it `<table>_<action>` with a qualifier
where needed, and describe it with `comment on policy`:

```sql
alter table public.providers enable row level security;

create policy providers_read_own
  on public.providers for select to authenticated
  using (owner_id = (select auth.uid()));
comment on policy providers_read_own on public.providers is
  'Owners can read their provider.';

create policy providers_read_admin
  on public.providers for select to authenticated
  using ((select public.is_admin()));
comment on policy providers_read_admin on public.providers is
  'Admins can read all providers.';
```

The providers table also has `providers_insert_own` and `providers_update_own`.

- Wrap `auth.uid()` and `public.is_admin()` in `(select …)` so Postgres
  evaluates them once per query, not once per row.
- Update policies carry both `using` and `with check`.

**Grants are explicit** (since `explicit_api_grants`, 2026-10-09;
`auto_expose_new_tables = false` in `supabase/config.toml`). **New tables and
functions in `public` reach only `service_role` by default, so each migration
must grant `anon` and `authenticated` exactly what they need, explicitly**:
the table privileges (or columns) each role uses, and `EXECUTE` on every
function they call directly or whose access rules call it (a role evaluating
a policy needs `EXECUTE` on the helpers in it). A table a role can't select
fails with "permission denied", even where a row policy would allow the row;
cover both the granted and the refused case in the pgTAP test. Never grant
`TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN` to the API roles.

**Every new function states its callers explicitly** (since
`function_execute_grants`, 2026-10-10: new functions get no `PUBLIC`
`EXECUTE`, only `service_role`'s default). Grant `EXECUTE` to exactly the
roles that run it:

- **Called through the API** (`rpc`): the roles that call it.
- **Used inside an access rule:** the roles that rule is for (a helper in a
  policy runs as the role being checked).
- **Used inside a check constraint or an ordinary (invoker) trigger:** the
  roles that write that table (both run as the writer). Prefer making such a
  trigger `security definer` with `set search_path = ''`, so the function it
  calls needs no grant.
- **Trigger functions themselves:** no grant (a trigger fires without the
  writer holding `EXECUTE`).
- **A new `security definer` function that visitors or signed-in users may
  call** must be added, with its roles, to the list in
  `supabase/tests/function_privileges.test.sql` in the same change;
  anything not on the list fails that test.
- **Test helpers** (`tests.*`, `pg_temp.*`) called after switching to an API
  role need an explicit grant too.
- **Extensions:** the no-`PUBLIC`-`EXECUTE` default is global for `postgres`,
  so a migration that creates or updates an extension (`create extension`,
  `alter extension … update`) leaves its new functions callable only by
  the owner (and `service_role`, through its default, only if they land in
  `public`; extensions usually install into `extensions`). Grant `EXECUTE` on the
  functions the apps or access rules use to exactly the roles that need
  them, in that migration, and test each allowed and refused call.

**Column grants** decide which columns signed-in users may write. Older
tables were made when the defaults granted everything, which is why their
migrations revoke first, then grant back only what users may write:

```sql
revoke insert, update on public.providers from anon, authenticated;
grant insert (owner_id, display_name, city) on public.providers to authenticated;
grant update (display_name, city) on public.providers to authenticated;
revoke select on public.providers from anon;
revoke delete on public.providers from anon, authenticated;
```

Columns left out of the grants (`status`, every `stripe_*` column) can only be
written by the service role, which the server uses after its own checks.

**Delete behaviour.** Having no delete policy already makes a user's delete
affect 0 rows, silently. For never-deleted tables, also
`revoke delete … from anon, authenticated`, so a mistaken delete raises an
error instead.

## Tests

pgTAP files live in `supabase/tests/` and end in `.test.sql`. Each file is one
transaction that rolls back, so it leaves nothing behind:

```sql
begin;
\ir _helpers/users.psql
select plan(<n>);
-- ...
select * from finish();
rollback;
```

`plan(n)` counts assertions, not scenarios. The providers file has 14
numbered checks and 21 assertions; a check that needs "no error" plus "value
unchanged" is two (`5a` / `5b`).

**Shared setup: `supabase/tests/_helpers/users.psql`.** It ends in `.psql`
because the runner executes every `.sql` file in the folder as a test. As a
`.sql` file, it once ran outside a transaction and left a `tests` schema
behind in the local database. Include it with `\ir`; everything it creates
rolls back with the test.

| Function | Acts as |
| --- | --- |
| `tests.create_user(email)` → uuid | A bare `auth.users` row |
| `tests.authenticate_as(user_id)` | That signed-in user: role `authenticated`, JWT claims with `sub` |
| `tests.authenticate_as_admin(user_id)` | The same, plus `app_metadata.role = 'admin'` |
| `tests.authenticate_as_anon()` | A signed-out visitor (`anon`) |
| `tests.authenticate_as_service_role()` | The server with the secret key; RLS doesn't apply |
| `tests.clear_authentication()` | Back to the runner's superuser, to inspect rows RLS hides |

**Keep roles on separate users.** The admin user (`authenticate_as_admin`)
never owns a `providers` row, in tests or in hosted test data. Create a
separate user for each provider. Admin read rules return every row, so an
admin who is also a provider makes an own-rows rule look right even when it's
broken. The same applies to hosted test data: test providers get their own
logins (`+provider1`, `+provider2`), never the admin login.

Capture ids with psql's `\gset`: `select tests.create_user('a@test.local') as a \gset`,
then use `:'a'`.

**How each outcome shows up:**

| Case | What Postgres does | Assert with |
| --- | --- | --- |
| Row policy rejects an insert | Error `42501`, "new row violates row-level security policy for table …" | `throws_ok(sql, '42501', '<message>')` |
| Column or privilege not granted (write, select, delete) | Error `42501`, "permission denied for table …" | `throws_ok(sql, '42501', '<message>')` |
| Row policy hides the row on update | **No error, 0 rows changed** | `lives_ok`, then `clear_authentication()` and `is()` on the value |
| Unique constraint | Error `23505` with the constraint name | `throws_ok(sql, '23505', …)` |
| `on delete restrict` blocks deleting the parent | Error `23503`, "update or delete on table … violates foreign key constraint …" | `throws_ok(sql, '23503', '<message>')`, run as the runner |
| Visibility | Rows are filtered, not refused | `is((select count(*)::int …), n)` |

RLS rejections and missing privileges both raise `42501`. Always assert the
message too, or a test for one passes on the other.

**Checking a trigger inside one transaction.** `now()` is fixed for the whole
transaction, so a fresh row's `updated_at` already equals `now()`. Backdate it
with triggers switched off, update, then assert `updated_at = now()`:

```sql
select tests.clear_authentication();
set local session_replication_role = replica;
update providers set updated_at = '2000-01-01' where owner_id = :'a';
set local session_replication_role = origin;
```

**Prove each new test can fail.** When you write a new access-rule test,
break the rule once, confirm a test fails, then restore the rule. The easiest
way is a scratch copy of the test file with the breaking statement just
before `select plan(…)`, for example `grant delete on providers to authenticated;`.
Run it with `npx supabase test db <scratch folder>`, then delete the copy.

For the providers tests, these rules were each broken on purpose, and each
caused at least one failure:

- Stripe columns granted to users
- `is_admin()` always true
- anon given read access
- the unique constraint dropped
- the insert policy opened up
- the trigger dropped
- delete granted back to users
- the owner link switched back to `on delete cascade`
