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
npm run build:check           # check both apps build (own folders; safe beside npm run dev)
npm run typecheck             # vue-tsc on both apps; must pass before committing
npm run job -- <name>         # run one timed booking job against localhost:3100
npm run db:test               # rebuild the local DB from migrations, run pgTAP tests
npm run db:push               # db:test, then apply to hosted Supabase, then db:types + db:docs
npm run db:types              # regenerate packages/types/src/database.ts from the linked project
npm run db:docs               # regenerate docs/schema/ with tbls (needs TBLS_DSN in root .env)
npm run schema:compare        # rebuild locally from migrations, compare with hosted; must show no differences
npm run build:secrets-check   # build both apps with sentinel secrets; fails if any reaches the output
```

**Ports are fixed** (`devServer.port` in each `nuxt.config.ts`): website 3100,
admin 3101. The Reserve uses 3000 and falls back to 3001, so keep this project
out of 3000–3001. Nuxt would silently fall back to another port, so each
app's `dev` script runs `scripts/check-port.mjs` first and refuses to start
if its port is taken. If you change a port, update the app's `dev` script,
`.claude/launch.json`,
`supabase/config.toml` (auth URLs), `NUXT_PUBLIC_SITE_URL` and the Supabase
dashboard's redirect URLs as well.

**Build checks use `npm run build:check`**, which builds each app into its
own folders (`.nuxt-check`, `.output-check`, a separate Vite cache). **Don't
run a plain `nuxt build` inside an app folder while that app's dev server is
running:** it writes into the `.nuxt` folder the dev server reads, and every
page then fails with a 500 until the dev server is restarted (seen
2026-10-02). `npm run typecheck` is safe to run alongside the dev servers.

`db:test` needs Docker running. It resets the **local** database only.

## Migrations

1. `npx supabase migration new <snake_case_name>` and write the SQL.
2. Add or extend a test in `supabase/tests/` for every access rule the change
   adds or alters: both the allowed case and the blocked case.
3. `npm run db:test` until it passes.
4. Show the migration and test diff and wait for an explicit go-ahead.
5. `npm run db:push`. It applies to the hosted database, which can't be undone,
   so never run it as an automatic last step. It ends with
   `schema:compare`: any difference between hosted and the migrations is a
   failure to report, not to ignore. The comparison must also show no
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

- Policies are named `<table>_<action>` (`providers_read_own`); their
  plain-English meaning goes in `comment on policy`.
- Every table's migration states its delete behaviour. Tables that bookings,
  payments or payouts point to are deactivated, never deleted.

## Roles

- **Admin:** `app_metadata.role = "admin"` on the Supabase user. Only the
  service role can write `app_metadata`. SQL checks it with `public.is_admin()`;
  TypeScript with `isAdmin()` from `@repo/types`.
- **Provider:** anyone who owns a `providers` row (`owner_id = auth.uid()`).
  Provider isn't stored as a role.
- **Customer:** any other signed-in user.
- **Granting admin** is done by hand in the SQL Editor, never from an app.
  Use this, not a bare `update auth.users`: it refuses a login that owns a
  business. (The database also refuses to give a provider to an admin, but
  deliberately has no trigger on `auth.users`; see `docs/decisions.md`.)

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
      raise exception '% owns a business, so it can''t be made an admin. Use a login that owns no business, or move the business to another login first.', v_email;
    end if;
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}'
     where id = v_id;
    raise notice '% is now an admin. Sign out and back in to pick up the role.', v_email;
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
- Return and refresh URLs come from `runtimeConfig.public.siteUrl`, never from
  the request's Host header.

## Types

- `@repo/types` is the shared package. `database.ts` is generated by
  `npm run db:types` (part of `db:push`), and both apps type their Supabase
  clients with it (`supabase.types` in each `nuxt.config.ts`, by absolute
  path). Pass `SupabaseClient<Database>` to helpers, never a bare
  `SupabaseClient`, which makes every table `never`.
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
built; `docs/design/booking-and-checkout.md` is the original design.
