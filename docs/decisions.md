# Decisions

Settled choices, newest first. Revisit one only on purpose, and record the
change as a new row rather than editing the old one.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-09-27 | Admin-only reference lists (cities, service areas, categories) are written from the admin app under admin-only database rules; status changes, anything crossing users, and anything touching Stripe keep server routes | Simple lists need no server code when the database already enforces admin-only writes; state changes need server-side checks, and Stripe needs the secret key |
| 2026-09-27 | ui-thing components live once, in a shared Nuxt layer at `packages/ui` that both apps extend, with one set of theme tokens (neutral until the brand is set) | One component set and one theme for the website and admin app; the ui-thing CLI works inside the layer, so there's no need to install into each app |
| 2026-09-27 | Services are booked by request and confirm, with one fixed price per listing | Fastest path to real bookings; providers don't have to keep a calendar on lokl. Time slots can be added later. |
| 2026-09-27 | At checkout (step 4), a Service request places a hold on the card; it's charged only when the provider accepts | No charge for declined requests, so no refund work |
| 2026-09-27 | Unanswered Service requests expire after 48 hours and the hold is released | Keeps customers from waiting indefinitely; well inside Stripe's hold window |
| 2026-09-27 | Experiences are booked into scheduled sessions with a capacity, paid immediately | A spot either exists or doesn't, so there's nothing to confirm |
| 2026-09-27 | Categories are flat, admin-managed, separate for Services and Experiences, one per listing | Enough structure for launch; subcategories can come later |
| 2026-09-27 | Cities are an admin-managed list, not free text; launch with Atlanta only | Fixes the "Atanta" walkthrough finding and makes search by city reliable |
| 2026-09-27 | Services happen either at the provider's location or at the customer's, within listed service areas | Covers salons and studios as well as mobile services |
| 2026-09-27 | Exact addresses are private until booking; listings show an area only | Many providers work from home |
| 2026-09-27 | Services have one price; Experiences are priced per person; all amounts in cents | Matches how each is sold; cents avoid rounding errors |
| 2026-09-27 | Up to 8 photos per listing, first is the cover, at least one required to publish | Listings without photos don't sell |
| 2026-09-27 | Services go live once the provider's payouts are Ready; Experiences need owner review | Services are lower risk; Experiences are the brand-defining inventory |
| 2026-09-27 | One `listings` table for both kinds, with kind-specific rules as check constraints | Browse, search, photos and review work the same way for both |
| 2026-09-27 | lokl uses its own Supabase project; it shares no logins or database with any other app | The old project also hosted the blog, so blog users could sign into the provider dashboard and generated types and schema docs mixed in the blog's tables |
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
