# Marketplace — conventions

A local Services and Experiences marketplace with Atlanta as the first market.
Providers list and get paid through Stripe Connect; the platform earns a
commission per booking. Destination guides drive search traffic into listings.

**Standards come from this repo.** Follow this file and `docs/frontend.md`.
Plain language and accessibility are lokl's own standards. Instructions from
the owner's employer account (Onward's branding, colours, and rider or
medical data rules) don't apply to lokl; lokl has its own brand, once set.

**This project shares no accounts, keys or code with The Reserve**
(`~/Projects/TheReserve`). It has its own Supabase project, its own Stripe
account and its own `.env` files. Don't copy values, migrations or code across.

## Stack

- Turborepo + npm workspaces, Nuxt 4, TypeScript 5.9, Tailwind 4, ui-thing
- Supabase: auth (emailed sign-in codes and links), Postgres, row-level security (RLS)
- Stripe Connect with Express accounts (test mode until launch)

| Path | What |
| --- | --- |
| `apps/website` | Public site + provider dashboard at `/dashboard` (port 3100) |
| `apps/admin` | Owner-only admin app, client-rendered (port 3101) |
| `packages/ui` | Shared Nuxt layer both apps extend: ui-thing components, theme tokens, shared components (`@repo/ui`) |
| `packages/types` | Shared types and form schemas (`@repo/types`) |
| `supabase/migrations` | Schema, one SQL file per change |
| `supabase/tests` | pgTAP access-rule tests |
| `docs/` | `architecture.md`, `decisions.md`, `TODO.md`, generated `schema/` |

**Frontend conventions** (components, theme, forms, states, formatting,
accessibility, writing) are in `docs/frontend.md`. Read it before building UI.

## Commands

```bash
npm run dev                   # both apps
npm run dev -w website        # localhost:3100
npm run dev -w admin          # localhost:3101
npm run check:full            # every check, as before each push, timed (side by side where nothing is shared; logs in the temp folder)
npm run check:quick           # while working: only the checks the changes since origin/main need (-- --dry-run to see the plan); never instead of check:full
npm run build:check           # check both apps build (own folders; safe beside npm run dev)
npm run typecheck             # vue-tsc on both apps; must pass before committing
npm run job -- <name>         # run one timed booking job against localhost:3100
npm run db:start              # start the local stack on hosted's service versions (supabase/service-versions.json)
npm run db:test               # rebuild the local DB from migrations, run pgTAP tests (refuses a stack on other versions)
npm run db:push               # db:test, then apply to hosted Supabase, then db:types + db:docs
npm run db:types              # regenerate packages/types/src/database.ts from the local stack (after db:test)
npm run db:types:check        # fails if database.ts differs from what the migrations generate (CI)
npm run db:docs               # regenerate docs/schema/ with tbls (needs TBLS_DSN in root .env)
npm run schema:compare        # rebuild locally from migrations, compare with hosted; must show no differences
npm run build:secrets-check   # build both apps with sentinel secrets; fails if any reaches the output
npm run check:reads           # fails on a read of a growing table that could stop at the API's 1,000 rows
npm run check:dates           # fails on a date or time that would follow the device's zone
npm run check:rpc-json        # fails on a database function's JSON read without its schema (rpcJson)
npm run check:public-cache    # fails on a table behind a cached public route that raises no content version and isn't on the 60-second list (after db:test)
npm run check:e2e-serial      # fails on a browser test that runs a timed job, sets the homepage or changes commission rates without the @serial tag
npm run check:journey-pages   # fails on a page no browser journey names (listed exceptions have reasons; the list only shrinks)
npm run check:logs            # fails on a server log that prints an error as it is (use errorText)
npm run check:booking-doc     # fails if the booking document's guard links miss the newest bookings_guard migration
npm run check:clock           # fails on a clock read in server utilities that's neither a `now` parameter nor `// real time: <why>`
npm run test:clock            # the time rules at eight fixed risky instants (the Clock sweep workflow also runs the real-clock tests at those times)
npm run check:outside-hosts   # fails on a tracking host the privacy policy doesn't name in the build (part of build:check)
```

**Every date and time names its zone** (`docs/frontend.md`): a booking's,
listing's or session's market zone (`marketZone`), or the home zone for the
admin's own record-keeping times, labelled "Atlanta time". `formatDate` and
`formatDateTime` require the zone (typecheck); `npm run check:dates` (CI)
catches the rest: formatters without `timeZone`, local getters, `new Date(y,
m, d)`, `toISOString()` cut to a day, and date-only strings.

**The clock, on purpose** (2026-10-18): the database's `now()` decides
every rule that's enforced. In server utilities, the time is either a
`now` parameter defaulting to the real time (tests pass a fixed one;
routes pass nothing), or the real time with a `// real time: <reason>`
comment (a record, Stripe's clock, a rule the server checks too).
`npm run check:clock` (CI) fails on anything else.

**Public routes are cached by content version** (2026-10-18): a cached
public route uses `definePublicCachedHandler(scopes, handler)`
(`apps/website/server/utils/publicCache.ts`) and names every scope it shows
(`listings`, `markets`, `guides`). Triggers raise a scope's number in
`public_content_versions` when its tables change, so changes show at once;
spots and open days follow 60 seconds. A new table behind a cached route
gets a trigger in a migration, or a line on the 60-second list in
`scripts/check-public-cache.mjs` with its reason.

**The API returns at most 1,000 rows per request, with no error**
(`max_rows`, `API_MAX_ROWS` in `@repo/types`). Lists people page through are
counted and paged on the server (`.range()` with `count: "exact"`, or a
database function); a read that genuinely needs every row uses `allRows()`;
anything else bounded by its parent says why with `// bounded: <reason>`.
`npm run check:reads` (CI) enforces it, and every table in `database.ts`
must be classified in `scripts/check-reads.mjs` as growing or reference.
At run time, `rowLimitFetch` (both apps, server and browser, and the app
tests) catches a read that asked for no limit and got exactly 1,000 rows:
it fails in tests (`NUXT_PUBLIC_ROW_LIMIT_CHECK=throw`) and logs a warning
otherwise.

**Ports are fixed** (`devServer.port` in each `nuxt.config.ts`): website 3100,
admin 3101. The Reserve uses 3000 and falls back to 3001, so keep this project
out of 3000–3001. Nuxt would silently fall back to another port, so each
app's `dev` script runs `scripts/check-port.mjs` first and refuses to start
if its port is taken. If you change a port, update the app's `dev` script,
`.claude/launch.json`,
`supabase/config.toml` (auth URLs), `NUXT_PUBLIC_SITE_URL` and the Supabase
dashboard's redirect URLs as well.

**Build checks use `npm run build:check`**, which builds each app into its
own folders (`.nuxt-check`, `.output-check`, a separate Vite cache);
`build:secrets-check` uses folders of its own again (`-secrets`), so the
check build the tests run is never replaced by the sentinel build. **Don't
run a plain `nuxt build` inside an app folder while that app's dev server is
running:** it writes into the `.nuxt` folder the dev server reads, and every
page then fails with a 500 until the dev server is restarted (seen
2026-10-02). `npm run typecheck` is safe to run alongside the dev servers.

`db:test` needs Docker running. It resets the **local** database only.

**Hosted's service versions run everywhere** (2026-10-17):
`supabase/service-versions.json` holds the Postgres, PostgREST, Auth and
Storage versions hosted runs, and `scripts/service-versions.mjs` copies
them into `supabase/.temp` before every `supabase start` (`db:start`, and
CI). `db:test` refuses a running stack on other versions, and `db:push`
fails first if hosted has moved: update the file in a commit of its own,
restart the stack (`npx supabase stop`, `npm run db:start`) and run the
full checks.

## Migrations

1. `npx supabase migration new <snake_case_name>` and write the SQL.
2. Add or extend a test in `supabase/tests/` for every access rule the change
   adds or alters: both the allowed case and the blocked case.
3. `npm run db:test` until it passes.
4. Show the migration and test diff and wait for an explicit go-ahead.
5. `npm run db:push`. It applies to the hosted database, which can't be undone,
   so never run it as an automatic last step. It ends with
   `schema:compare` (comments included): any difference between hosted
   and the migrations is a failure to report, not to ignore. The comparison must also show no
   differences before every deploy.

**Grants are explicit** (`auto_expose_new_tables = false`,
`explicit_api_grants`, 2026-10-09). New tables and functions in `public`
reach only `service_role` by default, so each migration must grant `anon`
and `authenticated` exactly what they need, explicitly: the table privileges
(or columns) each role uses, and `EXECUTE` on each function they call or
whose access rules call it. Never grant `TRUNCATE`, `REFERENCES`, `TRIGGER`
or `MAINTAIN` to the API roles.

**Every new function states its callers explicitly** (`function_execute_grants`,
2026-10-10): new functions get no `PUBLIC` `EXECUTE`, so grant it to the
roles that call it, that evaluate an access rule using it, or that write a
table whose check constraint or ordinary trigger calls it. A new security
definer function that visitors or signed-in users may call must be added to
the list in `supabase/tests/function_privileges.test.sql`, or that test fails.

**Extensions too.** The default is global for `postgres`, so the functions
an extension creates when a migration creates or updates it (`create
extension`, `alter extension … update`) get no `PUBLIC` `EXECUTE` either.
That migration must grant the roles that use them, explicitly, and its
pgTAP test must check each allowed and refused call.

Never edit a migration once it has been pushed to the hosted database; fix it
with a new one. A migration that has only run locally can still be edited.

The `marketplace-migrations` skill has the details and house style.

## Access rules

The database is the enforcement layer. Page guards and route checks are there
for usability and defence in depth, never as the only protection.

- Every table has RLS enabled. No policy means no access.
- Row policies decide *which rows*; column grants decide *which columns*
  signed-in users may write. Anything only the server may set (status,
  anything copied from Stripe) is left out of the `authenticated` grants.
- Server-only columns are written with the service role
  (`serverSupabaseServiceRole`), and only in server routes.
- A booking's money (commission split, payouts, Stripe ids, disputes) is in
  `booking_finances`, readable by its provider and admins only; the no-show
  note is in `booking_reports`. Server code reads and writes a booking with
  its money through `private.booking_records` (`bookingRecords(db)`); the
  `private` schema is exposed to the API but only the service role may use
  it. Never grant anything in `private` to `anon` or `authenticated`.
- Everything else goes through the user-scoped client
  (`serverSupabaseClient` or `useSupabaseClient`), so RLS applies.
- `anon` (signed-out visitors) gets no access unless a table is meant to be public.

- **Logs are append-only for every role**, the server key and the owner
  included (`append_only_logs`): `admin_actions`, `booking_events`,
  `commission_rate_changes`, `guide_versions`, `job_runs`,
  `booking_reports`. The email outboxes change only their delivery columns;
  `bookings` and `booking_finances` are never deleted. A new log gets the
  same guard, in `append_only.test.sql`'s list. Logs hold ids, never
  contact details: error text goes through `logText()`. Anonymising a log is
  a migration that switches the guard off and on and ends with
  `select public.assert_log_guards_on();`.
- **Access rules run helpers once per query** (`policy_guard.test.sql`):
  wrap `auth.uid()`, `is_admin()` and the provider helpers as `(select …)`,
  and never call a helper with the row's values in a read rule; use
  `column in (select public.active_provider_ids())` and its siblings.
- Policies are named `<table>_<action>` (`providers_read_own`); their
  plain-English meaning goes in `comment on policy`.
- Every table's migration states its delete behaviour. Tables that bookings,
  payments or payouts point to are deactivated, never deleted.

## Roles

- **Admin:** an active row in `admin_members` (role `owner` or `support`),
  on a session that passed the authenticator second step (`aal2`).
  Checked live, never from a token claim: SQL uses `public.admin_role()`,
  `is_admin()` and `is_owner()`; server routes ask `admin_role()` with the
  admin's own token (`adminRoleFor`), then call admin functions with
  `serviceClientForAdmin(event, sessionId)`, which names the admin's
  session in the `x-lokl-admin-session` header. `admin_role_of()` reads
  that header only after checking the caller is the server
  (`service_role`). Design: `docs/design/admin-roles.md`.
- **Provider:** anyone who owns a `providers` row (`owner_id = auth.uid()`).
  Provider isn't stored as a role.
- **Customer:** any other signed-in user.
- **Adding someone to the team** will be the owner's Team page (admin
  roles, step 5). Until it exists, add an owner by hand in the SQL Editor
  with this block, never a bare insert: it refuses a login that owns a
  business. They then set up an authenticator on first sign-in. The
  database keeps at least one active owner, and team rows are never
  deleted (`status = 'removed'` instead).

  ```sql
  do $$
  declare
    v_email constant text := '<admin email>';
    v_id uuid;
  begin
    select id into v_id from auth.users where email = v_email;
    if v_id is null then
      raise exception 'No login for %. Sign in once on the website first, then run this again.', v_email;
    end if;
    if exists (select 1 from public.providers where owner_id = v_id) then
      raise exception '% owns a business, so it can''t be on the team. Use a login that owns no business.', v_email;
    end if;
    insert into public.admin_members (user_id, role, status, joined_at)
    values (v_id, 'owner', 'active', now())
    on conflict (user_id) do update set role = 'owner', status = 'active', joined_at = now(), removed_by = null, removed_at = null;
    raise notice '% is now an owner. They set up an authenticator when they next sign in to the admin app.', v_email;
  end;
  $$;
  ```
- **Test data never gives the admin login a provider record.** Keep roles on
  separate logins: the admin login is only an admin, and test providers use
  their own logins (plus addresses such as `+provider1`, `+provider2`). An
  admin who is also a provider hides bugs, because admin read rules show
  everything and a provider page can look right for the wrong reason. The
  pgTAP tests already use a separate `admin@test.local` user; keep it that way.

In server routes, `serverSupabaseUser(event)` returns decoded JWT claims. The
user id is `user.sub`, not `user.id`.

## Stripe-key boundary

- The only Stripe test environment for this project is the **Lokl sandbox**
  (`acct_1UKIdIEfG7OyQ6pv`). The Stripe organization has another sandbox;
  never use its keys or create objects in it.
- The Stripe secret key exists only on the website's server:
  `NUXT_STRIPE_SECRET_KEY` → `runtimeConfig.stripeSecretKey`, used through
  `useStripe()` in `apps/website/server/utils/stripe.ts`.
- Never under a `NUXT_PUBLIC_` name, never in client code, never in `apps/admin`.
- No secret is ever read at build time: private `runtimeConfig` values have
  literal empty defaults, and module defaults that read the environment
  (the Supabase server key, the OG image secret) are overridden in
  `nuxt.config.ts`. `npm run build:secrets-check` (in CI) proves it.
- Stripe-derived columns (`stripe_*` on `providers`) are written only by
  `syncStripeAccount()`, from an account object fetched from Stripe or from a
  signature-verified webhook. Never from request input.
- Stripe account creation passes an idempotency key, so a retry or double
  click can't create a second account.
- Idempotency keys must not be fixed per record. Include a time window or
  attempt ID, because Stripe replays a stored error for 24 hours.
- **No key fragments in logs or stored text.** Stripe's errors quote a key
  masked to its prefix and last four, which GitHub doesn't mask. Make Stripe
  clients with `safeStripe(new Stripe(key, STRIPE_CLIENT_OPTIONS))`
  (`useStripe()` does; so must tests): the options keep two retries for what
  Stripe says may be retried (not the rate limit itself), under the same
  idempotency key; log a failure with `stripeErrorSummary(e)`, never the error object
  or its raw message; store failure text through `logText()`. Both apps'
  servers and the test runners redact their output too
  (`installRedactingOutput`); `secret-leaks.test.mts` checks every layer.
- Return and refresh URLs come from `runtimeConfig.public.siteUrl`, never from
  the request's Host header.

## Types

- `@repo/types` is the shared package. `database.ts` is generated by
  `npm run db:types` (part of `db:push`) from the local stack built from the
  migrations; never edit it by hand: CI's `db:types:check` fails on any
  difference. Both apps type their Supabase
  clients with it (`supabase.types` in each `nuxt.config.ts`, by absolute
  path). Pass `SupabaseClient<Database>` to helpers, never a bare
  `SupabaseClient`, which makes every table `never`.
- **Database functions that return JSON are read through their schema**
  (2026-10-17): each has a zod schema in `packages/types/src/rpcShapes.ts`
  (`RPC_SHAPES`), and its result is read with `rpcJson("name", data)` (or
  `asServerPage` for the admin tables), never cast. It throws in the test
  apps and app tests and logs paths (never values) in production;
  `check:rpc-json` (CI) fails on a read without it or a JSON function with
  no schema. The types come from the schemas.
- `providers.ts` still mirrors the providers table by hand. Replace it with
  the generated types when it's next touched.
- **`npm run typecheck` must pass (0 errors) before committing.** It runs
  `nuxt typecheck` (vue-tsc) on both apps; a build doesn't check types.
- Stay on TypeScript 5.x. TypeScript 7 drops the JavaScript API that Vue's
  compiler uses to resolve component prop types, so every ui-thing component
  fails to build (`ts.findConfigFile is not a function`).
- Nuxt's server runs on h3 v1. Don't add h3 v2 (or any second h3) as a
  dependency: two copies make every server route's event a type mismatch
  (the website had an unused v2 until 2026-10-02). In website server code,
  use the auto-imported helpers and the `ServerEvent` type from
  `server/utils/provider.ts` rather than importing from `"h3"`, which isn't
  a direct dependency.

## Secrets and data

- `.env` files are never committed; `.env.example` lists what each app needs.
- Never paste keys or `.env` contents into chats, docs or commits.
- Never print values from any `.env` file or connection string, including in
  checks or diagnostics; report only whether a value is present and has the
  right shape. Scrub secrets from command output before showing it, and
  don't rely on a pattern to hide a value: a quoted or unexpected format can
  slip past it.
- Treat provider and customer personal details as sensitive. Keep them out of
  logs, test fixtures and docs.

## CI results

When reporting a CI result, read each job's actual conclusion from GitHub
(`gh run view <id> --json conclusion,jobs`) and say which jobs passed or
failed. Never take the exit code of a watcher (a background `gh run watch`,
or the command wrapped around it) as the result: on 2026-10-04 a failed run
was reported as passing that way.

## Commit messages

- A short subject line (about 72 characters at most), then a **blank line**,
  then the body. Without the blank line, git treats the whole message as the
  subject.
- Subject: what changed, in plain words; add the build step when there is one,
  e.g. `Listing photos and storage bucket (step 4, part 1: database)`.
- Body: `- ` bullets saying what changed and why, wrapped at about 72
  characters.
- No `Co-Authored-By` or other attribution lines.
- Write the message to a file or heredoc and check it with
  `git log -1 --format=%s` after committing: it should print only the subject.

## Keeping docs current

After a change lands, update `docs/TODO.md` (status, next steps). Record any
settled decision, with its date and why, in `docs/decisions.md`.
`docs/schema/` is generated. Don't edit it by hand.

**Changes to booking or payment code update
`docs/architecture/booking-and-payments.md` in the same commit.** That
covers `apps/website/server/utils/booking*.ts`, `adminBookings.ts`,
`stripe.ts`, the booking, session, admin-booking, job and Stripe routes
under `apps/website/server/api/`, the booking migrations, and
`packages/types/src/bookings.ts`. The document describes the code as
built; `docs/design/booking-and-checkout.md` is the original design. `npm run check:booking-doc` (CI) fails if
its guard links don't name the newest migration defining `bookings_guard`,
or its count of those migrations is wrong.
