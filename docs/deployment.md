# Deployment and releases

How a change reaches production, and the rules around it. Adopted
2026-10-19, after The Reserve's workflow, adjusted for lokl's two apps
(`website` and `admin`) and its own checks.

## Where lokl runs today

- **No hosting yet.** Neither app is deployed; the hosting choice is open
  (docs/TODO.md, Domain and hosting). Nothing deploys from `main` today.
- **One Supabase project**, the hosted one, which is production's: real
  sign-ins, and the owner's admin login. The dev servers on 3100 and 3101
  use it too. Every test runs against a local stack, never against it.
- **One Stripe test sandbox** for every test (the Lokl sandbox,
  `acct_1UKIdIEfG7OyQ6pv`), through the `stripe-sandbox` environment in
  GitHub.

## Branching and releases

- **`main` is production.** It is protected on GitHub: a pull request is
  required, these four status checks must pass, and nothing bypasses them,
  administrators included:

  | Required check | What it is |
  | --- | --- |
  | `checks` | typecheck, the source checks, UI, email and clock tests, the secrets build check |
  | `database` | pgTAP, the types and public-cache checks, both apps built, the app tests without Stripe, Realtime |
  | `e2e` | waits for the three Playwright shards, `e2e (1/3)`, `e2e (2/3)` and `e2e (3/3)`, and passes only if each passed |
  | `stripe` | the Stripe app tests, against the sandbox |

  `stripe` and the shards need the sandbox key; they run on pushes to
  `main` and on this repository's pull requests, and fail when the key is
  missing rather than passing having tested nothing. A fork's pull request
  skips them and never gets the secret, so it can't merge until someone
  with access re-runs it from a branch here.
- **Every change is a feature branch off `main`,** merged through a pull
  request once the required checks pass, and deleted after the merge.
  There is no long-lived development branch.
- **Before pushing a branch,** `npm run check:full` runs every check
  locally (`npm run check:quick` while working).
- **Required approvals are off for now:** one engineer can't approve their
  own pull request, so the rule would only block. **When a second engineer
  joins, turning on required approvals (one review) in `main`'s
  protection is the step to take.** Nothing else in this workflow changes
  that day.
- **Previews stand in for a development branch:** once hosting is
  connected, every pull request gets a preview of both apps, and that is
  where a change is tried before it merges. A preview never uses the
  production database's keys (decision 1, below), so **previews stay off
  until a separate staging Supabase project exists**. Until then a change
  is tried on the local stack (`npm run build:check`, then
  `node scripts/ci-start-apps.mjs`) and in CI's journeys.

## Database changes and merges

- A migration's pull request carries the migration, its pgTAP tests and
  the regenerated `database.ts` (CI's `db:types:check` refuses one that
  differs from what the migrations build).
- **`npm run db:push` runs right after the merge,** from the updated
  `main`, never from a branch: a branch that never merged would leave
  hosted ahead of `main`. The migration and `schema:compare` are shown to
  the owner first, and the push waits for an explicit go-ahead, as always.
- It ends with `schema:compare` (comments included), which must show no
  differences. `docs/schema/` is read from hosted, so its regenerated
  files go in a short follow-up pull request.

## Decisions

### 1. Previews must not touch production resources

Once hosting is connected, every pull request would get a preview of the
website and of the admin app. Those previews must never accept real
sign-ins, write real data, or be a registered Stripe endpoint.

- Per-environment settings (production, preview, development): only
  production carries the production Supabase project's URL and keys,
  live Stripe keys, the production webhook secret, Resend's production
  sending and the real site addresses (`NUXT_PUBLIC_SITE_URL`,
  `NUXT_ADMIN_ORIGIN`, `NUXT_PUBLIC_WEBSITE_URL`).
- A preview gets test Stripe keys, is never a registered Stripe webhook
  endpoint, and points at a staging Supabase project. **There is no
  staging project yet, so previews stay off** (docs/TODO.md, Staging site).
- Consider password protection for previews, so they aren't public at
  all; the production Stripe webhook route must never be behind it.
- The admin app's preview needs the website's preview address (and the
  website the admin's, for `NUXT_ADMIN_ORIGIN`), so the two previews of a
  pull request are paired; worked out when hosting is chosen.

### 2. The Stripe sandbox environment

The `stripe-sandbox` environment holds `STRIPE_SANDBOX_SECRET_KEY` (a
restricted key for the Lokl sandbox; permissions in docs/decisions.md,
2026-10-03). Its deployment branch rules allow `main` and
`refs/pull/*/merge`, the ref of this repository's pull requests, so
`stripe` and the e2e shards can be required checks. Forks never get the
secret: their pull requests skip those jobs. A missing key fails the
jobs on pushes and on this repository's pull requests (2026-10-19).

### 3. CI's artifacts are public

The repository is public, so whatever CI uploads can be downloaded by
anyone: the e2e shards keep Playwright traces, screenshots and the report
for a week when they fail, and the jobs print the apps' server logs.

Checked 2026-10-19, every artifact then kept (four, 326 files, the traces
unpacked): no Stripe key, masked key fragment or webhook secret; no
Supabase secret key and no address of the hosted project; no Anthropic or
Resend key; the only tokens were test users' sessions from the local stack
(`127.0.0.1:55321`), and the only email addresses `@test.local`.

What keeps it so: every job runs against a local stack with the CLI's own
local keys; test data is made per test (`@test.local` users, made-up Stripe
accounts); the Stripe key is used only on the servers and in the tests'
Node code, never in a browser page a trace records; the apps' servers and
the test runners redact keys from their output (`installRedactingOutput`,
`secret-leaks.test.mts`); and nothing in CI reads the hosted project or
the `.env` files. A change to what CI uploads checks this again.

## Owner's settings in GitHub

Set by hand (an admin's settings, not in the repository):

- **Branch protection on `main`:** require a pull request; require these
  status checks to pass: `checks`, `database`, `e2e`, `stripe`; don't
  allow bypassing, administrators included; required approvals off (see
  above). Recommended, the owner's choice: require branches to be up to
  date before merging, so the checks ran against what `main` will be.
- **The `stripe-sandbox` environment's deployment branches:** `main` and
  `refs/pull/*/merge`.
