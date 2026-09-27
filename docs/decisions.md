# Decisions

Settled choices, newest first. Revisit one only on purpose, and record the
change as a new row rather than editing the old one.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-09-27 | The only Stripe test environment for this project is the Lokl sandbox (`acct_1UKIdIEfG7OyQ6pv`); the organization's other sandbox must not be used | Keeps test accounts, payouts and keys in one known place |
| 2026-09-27 | Logins that own a provider can't be deleted; suspend or anonymize the provider first | `providers.owner_id` is `on delete restrict`, so deleting a login can't silently remove a provider and, later, strand its bookings and payouts |
| 2026-09-27 | Local Supabase ports moved to 55320–55329 (edge inspector 8084) | The Reserve's local stack uses the 5432x defaults; both can now run at once |
| 2026-09-27 | Fixed dev ports: website 3100, admin 3101 | The Reserve uses 3000 and falls back to 3001; fixed ports keep auth redirect URLs stable |
| 2026-09-27 | Deleted the `apps/docs` template app | Unused Next.js leftover, and its dev port collided with The Reserve |
| 2026-09-27 | The admin app holds no Stripe keys | Only the website's server talks to Stripe; fewer places a secret can leak |
| 2026-09-27 | Tables that bookings, payments or payouts point to are deactivated, never deleted; every other table's migration states its delete behaviour, with the reason in its design doc | Money history must stay intact; everywhere else, deletion is a choice made on purpose |
| 2026-09-27 | `comment on table/column/policy` says what things mean; `--` comments say why the migration is written that way | Meaning surfaces in the Supabase dashboard and the generated schema docs; reasoning stays with the SQL |
| 2026-09-27 | Policies named `<table>_<action>`, with the plain-English description in `comment on policy` | Predictable names to grep and reference; readable meaning alongside |
| 2026-09-27 | A migration is editable until it's pushed to the hosted database; after that, fixes go in a new migration | The hosted database's history must match the files |
| 2026-09-27 | New access-rule tests are proven by breaking the rule once, confirming a failure, then restoring it | A test that can't fail proves nothing |
| 2026-09-27 | Access-rule changes ship with pgTAP tests covering both allowed and blocked cases, and `db:push` runs `db:test` first | A rule that silently stops blocking must fail a test before it reaches the hosted database |
| 2026-09-27 | Schema designed in this repo as migrations in `supabase/migrations/` | One versioned source of truth, testable locally |
| 2026-09-27 | A provider = owning a `providers` row, not a role | The business record is needed anyway; avoids keeping two things in sync |
| 2026-09-27 | One provider per login for now (`owner_id` unique) | Simplest start; a members table can come later |
| 2026-09-27 | Status and Stripe fields on `providers` are server-only (column grants) | No one can mark themselves payout-ready or lift their own suspension |
| 2026-09-27 | Stripe Invoices and Stripe Tax skipped for now | Checkout covers payment; marketplace tax needs an accountant's review first |
| 2026-09-27 | Separate Stripe account from The Reserve, in the same Stripe organization | Separate money, statement name, Connect settings and API keys |
| 2026-09-27 | Stripe Connect with Express accounts | Stripe handles ID checks, bank details and payouts; providers need no existing Stripe account |
| 2026-09-27 | Admin role in `app_metadata.role` | Only the server can write it, so no one can make themselves admin |
| 2026-09-27 | Emailed sign-in links, no passwords; admin app never creates accounts | Simpler for providers; admin stays invitation-only |
| 2026-09-27 | Admin app client-rendered and `noindex` | It's a signed-in tool; server rendering adds nothing |
| 2026-09-27 | Two apps: website (with provider dashboard at `/dashboard`) and a separate admin app | Owner tools stay off the public site; providers sign in in one place |
| 2026-09-27 | Neutral grey styling for now | Product brand isn't set; colours are defined in one place per app |
| Before 2026-09-27 | Supabase for auth, database and access rules | Chosen up front to avoid switching data stores later (original plan) |
| Before 2026-09-27 | Nuxt 4 + TypeScript + Turborepo | Matches the owner's other projects (original plan) |
| Before 2026-09-27 | Free to list; revenue is a commission per completed booking | Aligns the platform with provider success; industry norm (original plan) |
