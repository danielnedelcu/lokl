# Marketplace — conventions

A local Services and Experiences marketplace with Atlanta as the first market.
Providers list and get paid through Stripe Connect; the platform earns a
commission per booking. Destination guides drive search traffic into listings.

**This project shares no accounts, keys or code with The Reserve**
(`~/Projects/TheReserve`). It has its own Supabase project, its own Stripe
account and its own `.env` files. Don't copy values, migrations or code across.

## Stack

- Turborepo + npm workspaces, Nuxt 4, TypeScript, Tailwind 4
- Supabase: auth (emailed sign-in links), Postgres, row-level security (RLS)
- Stripe Connect with Express accounts (test mode until launch)

| Path | What |
| --- | --- |
| `apps/website` | Public site + provider dashboard at `/dashboard` (port 3100) |
| `apps/admin` | Owner-only admin app, client-rendered (port 3101) |
| `packages/types` | Shared types (`@repo/types`) |
| `supabase/migrations` | Schema, one SQL file per change |
| `supabase/tests` | pgTAP access-rule tests |
| `docs/` | `architecture.md`, `decisions.md`, `TODO.md`, generated `schema/` |

`packages/ui` is a React leftover from the create-turbo template. Nothing uses it.

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
out of 3000–3001. If you change a port, update `.claude/launch.json`,
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

In server routes, `serverSupabaseUser(event)` returns decoded JWT claims. The
user id is `user.sub`, not `user.id`.

## Stripe-key boundary

- The Stripe secret key exists only on the website's server:
  `NUXT_STRIPE_SECRET_KEY` → `runtimeConfig.stripeSecretKey`, used through
  `useStripe()` in `apps/website/server/utils/stripe.ts`.
- Never under a `NUXT_PUBLIC_` name, never in client code, never in `apps/admin`.
- Stripe-derived columns (`stripe_*` on `providers`) are written only by
  `syncStripeAccount()`, from an account object fetched from Stripe or from a
  signature-verified webhook. Never from request input.
- Stripe account creation passes an idempotency key, so a retry or double
  click can't create a second account.
- Return and refresh URLs come from `runtimeConfig.public.siteUrl`, never from
  the request's Host header.

## Types

- `@repo/types` is the shared package. `database.ts` is a placeholder until
  `npm run db:types` has run against the linked project.
- `providers.ts` mirrors the providers table by hand. Replace it with the
  generated types once they exist.
- The website depends on `h3` v2, but Nuxt's server runs on h3 v1. In website
  server code, don't import from `"h3"`; use the auto-imported helpers and the
  `ServerEvent` type from `server/utils/provider.ts`.

## Secrets and data

- `.env` files are never committed; `.env.example` lists what each app needs.
- Never paste keys or `.env` contents into chats, docs or commits.
- Treat provider and customer personal details as sensitive. Keep them out of
  logs, test fixtures and docs.

## Keeping docs current

After a change lands, update `docs/TODO.md` (status, next steps). Record any
settled decision, with its date and why, in `docs/decisions.md`.
`docs/schema/` is generated. Don't edit it by hand.
