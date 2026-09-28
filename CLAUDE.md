# Marketplace — conventions

A local Services and Experiences marketplace with Atlanta as the first market.
Providers list and get paid through Stripe Connect; the platform earns a
commission per booking. Destination guides drive search traffic into listings.

**This project shares no accounts, keys or code with The Reserve**
(`~/Projects/TheReserve`). It has its own Supabase project, its own Stripe
account and its own `.env` files. Don't copy values, migrations or code across.

## Stack

- Turborepo + npm workspaces, Nuxt 4, TypeScript 5.9, Tailwind 4, ui-thing
- Supabase: auth (emailed sign-in links), Postgres, row-level security (RLS)
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
npx nuxt build                # run inside an app folder to check it builds
npm run db:test               # rebuild the local DB from migrations, run pgTAP tests
npm run db:push               # db:test, then apply to hosted Supabase, then db:types + db:docs
npm run db:types              # regenerate packages/types/src/database.ts from the linked project
npm run db:docs               # regenerate docs/schema/ with tbls (needs TBLS_DSN in root .env)
```

**Ports are fixed** (`devServer.port` in each `nuxt.config.ts`): website 3100,
admin 3101. The Reserve uses 3000 and falls back to 3001, so keep this project
out of 3000–3001. Nuxt would silently fall back to another port, so each
app's `dev` script runs `scripts/check-port.mjs` first and refuses to start
if its port is taken. If you change a port, update the app's `dev` script,
`.claude/launch.json`,
`supabase/config.toml` (auth URLs), `NUXT_PUBLIC_SITE_URL` and the Supabase
dashboard's redirect URLs as well.

`db:test` needs Docker running. It resets the **local** database only.

## Migrations

1. `npx supabase migration new <snake_case_name>` and write the SQL.
2. Add or extend a test in `supabase/tests/` for every access rule the change
   adds or alters: both the allowed case and the blocked case.
3. `npm run db:test` until it passes.
4. Show the migration and test diff and wait for an explicit go-ahead.
5. `npm run db:push`. It applies to the hosted database, which can't be undone,
   so never run it as an automatic last step.

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

- `@repo/types` is the shared package. `database.ts` is a placeholder until
  `npm run db:types` has run against the linked project.
- `providers.ts` mirrors the providers table by hand. Replace it with the
  generated types once they exist.
- Stay on TypeScript 5.x. TypeScript 7 drops the JavaScript API that Vue's
  compiler uses to resolve component prop types, so every ui-thing component
  fails to build (`ts.findConfigFile is not a function`).
- The website depends on `h3` v2, but Nuxt's server runs on h3 v1. In website
  server code, don't import from `"h3"`; use the auto-imported helpers and the
  `ServerEvent` type from `server/utils/provider.ts`.

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
