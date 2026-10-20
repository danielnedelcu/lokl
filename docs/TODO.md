# TODO

Last updated: 2026-10-03. Update this when the board changes.

lokl's domain is **hilokl.com** (docs/decisions.md). Finished work is in
"Done" at the bottom.

## Open now

- [ ] **Part 7 walkthrough, steps 7 to 11** (steps 1 to 6 passed
  2026-10-02; the rest wait for Resend's daily quota to reset). First run
  `npm run job -- send-emails` once to send anything held by the quota.
  As `+customer1` booking from `+provider1`:
  - [ ] 7. The provider cancels a booking with a reason: the customer gets
    "Cancelled … had to cancel", without the reason; the provider gets
    nothing.
  - [ ] 8. A no-show reported after the start: the customer gets "We got your
    report"; the provider gets "A customer reported a problem", without the
    note.
  - [ ] 9. `npm run job -- pay-out --booking <id> --as-of due` (paid with card
    4000 0000 0000 0077): the provider gets "Payout sent".
  - [ ] 10. A booking on a `+provider2` listing: the provider email goes to
    `+provider2`, not `+provider1`.
  - [ ] 11. The provider's cancellation subjects: as `+customer1`, cancel a
    booking 3+ days out (provider gets "Booking cancelled: {title} on {date},
    no payout"), and one inside 48 hours after the grace hour ("…, you'll
    still be paid"); as admin, refund and cancel one ("Cancelled by lokl: …,
    no payout"). The customer's subject stays "Cancelled: …", so the two no
    longer group together in Gmail.
- [ ] **A second "Cancelled" email.** Booking emails are sent once per booking
  and kind (`booking_emails_once`), so a booking cancelled twice gets one
  "Cancelled" email. The case: a customer cancels late (no refund), then lokl
  refunds them in full; they'd never be told about the refund. It can't happen
  yet: lokl has no way to refund an already cancelled booking (admin cancel
  refuses it). When that's added, give the refund its own email (e.g.
  `customer_late_cancel_refunded`) rather than reusing "Cancelled".
- [x] **Browse beyond 1,000 listings** (2026-10-10). Browse filters, sorts,
  counts and pages in the database (`public_browse`), then loads only the
  page's cards; `public-browse.test.mts` checks 1,051 listings.
- [ ] **Check a listing's address against its city and area** (zip check, or
  geocoding).
- [ ] **Sign-in codes guessed from many addresses at once.** Supabase limits
  verifications per IP address, not per email address. If that's ever seen,
  add a CAPTCHA on sending (Supabase supports Turnstile) or move to 8-digit
  codes (docs/design/sign-in-with-code.md, Attempt limits).
- [ ] **Audit log for listing reviews** (who approved, rejected, unpublished or
  restored what). Booking, email and provider actions are logged in
  `admin_actions` since 2026-10-03; listing reviews aren't yet.

## Build order

Each step depends on the ones before it.

1. [x] **Categories.** Admin creates and edits Service and Experience
   categories.
2. [x] **Listings.** Providers create Services and Experiences, with photos;
   Experiences queue for review; Services go live once payouts are ready.
3. [x] **Public browse and listing pages.** Category pages, search by city, a
   page per listing, all indexable. Card-sized photo copies since 2026-09-30.
4. [x] **Booking and checkout** (`docs/design/booking-and-checkout.md`).
   Commission: the provider absorbs it, 12% for Services and 20% for
   Experiences, editable by the admin (with history), and each booking keeps
   the rate it was made with.
   - [x] Part 1, database; part 2, checkout routes and payments webhook
     (2026-10-01).
   - [x] Part 3, booking forms, return pages and My bookings (2026-10-01).
   - [x] Part 4, provider accept and decline and the provider's bookings pages
     (2026-10-02; `booking_requests_answers`).
   - [x] Type errors: `npm run typecheck` on both apps must pass before
     committing (2026-10-02).
   - [x] Part 5, timed jobs and payouts, with holds for the admin
     (2026-10-02; `booking_payouts`).
   - [x] Part 6, cancellations, refunds and no-show reports, with the 1-hour
     grace period (2026-10-02; `booking_cancellations`).
   - [x] Part 7, booking emails (2026-10-02; `booking_emails`). Walkthrough
     steps 7 to 11 are under "Open now".
   - [x] Part 8, the admin side, and provider suspension with its emails
     (2026-10-03; `booking_admin`, `provider_account_emails`).
   - [x] Booking finances only the provider and lokl can read (2026-10-03;
     `booking_finances`, rehearsed first on a copy of the hosted data).
   - [x] A booking cancelled with a full refund keeps no payout hold
     (2026-10-03; `cancelled_bookings_hold_nothing`).
5. [x] **Booking management.** Covered by step 4 (parts 4, 6 and 8).
6. [x] **Admin actions.** Covered by step 4, part 8. Its leftover, the audit
   log for listing reviews, is under "Open now".
7. [ ] **Destination guides** (`docs/design/destination-guides.md`, reviewed
   2026-10-03). In parts: database, editor, AI draft, public pages, homepage.
   - [x] Part 1: database. Guides with draft and live copies (including
     the listings block), photos, versions, AI draft log, homepage
     features, `publish_guide()` and `unpublish_guide()`, the
     `guide-photos` bucket. Pushed 2026-10-03.
   - [x] Part 2: admin editor (no AI). Guides list and "New guide", the
     editor (Editor.js, autosave, web address check, listings block
     preview), photos with credits, publish and unpublish routes,
     versions with "Copy into draft", draft preview, shared `GuideBody`
     renderer. Built 2026-10-03.
   - [x] Part 3: AI draft. Prompt (`apps/admin/server/prompts/guide-writer.ts`),
     draft and undo routes, stale-phrase scanner and highlights, review
     confirmation, cost log, limits. Built 2026-10-03.
   - [ ] One real AI draft in the editor to confirm the body-loading fix
     (2026-10-03: the body now loads after the editor unlocks, autosave
     holds the body meanwhile; covered by
     `apps/admin/tests/guide-editor-order.test.mts`).
   - [x] Parts 4 and 5 together: public guide pages, the guides index,
     the homepage features and the admin's Homepage page; the first
     publish confirms the web address. Migration `public_guides` pushed
     2026-10-03. Browser checks done, and "Ten things to do on a weekend
     in Atlanta" unpublished and republished on the hosted database
     (gone from the page, index, homepage and sitemap within a minute,
     after the cache fix; back on republish, re-featured as the hero).
   - [x] The homepage's three guide places (2026-10-11, migration
     `homepage_three_guides`): a slim headline and the main guide on top,
     then "On lokl now", then the guides section with up to two cards; the
     admin's Main guide and More guides. E2e journey 21. The hosted
     homepage's fourth guide came off with the migration.
   - [x] Listing carousels on the homepage (2026-10-12, `ScrollCarousel`):
     an Experiences and a Services carousel below "On lokl now", 10 each
     and "See all"; docs/frontend.md, Carousels. E2e journey 24.
   - [x] The header search (2026-10-12, docs/design/search.md): Where,
     When and What on an adapted Navigation Menu, the results page at
     `/<market>/search`, a full-screen panel on phones, and a sticky
     header. E2e journey 26. Later: several areas or categories at once;
     a column per market.
   - [x] "On lokl now" shows one random Experience and one random Service
     beside the host card, picked on the server and cached for a minute
     (2026-10-12, `/api/public/homepage-listings`). E2e journey 24.
8. [ ] **Launch.** See "Staging site" and "Launch prep" below.

## Next features (in this order)

1. [x] **Provider profiles** (docs/design/provider-profiles.md, built
   2026-10-04; migration `provider_profiles`): avatar, cover photo,
   headline and bio, edited on the Business profile page (contact details
   refused, with what they look like); a profile card and "More from" on
   each listing page; the public profile at `/providers/<slug>`, in the
   sitemap; the admin's profile view and "remove with a reason", with the
   written profile rules and an email to the provider. Later: a new
   address on a rename, with a permanent redirect.
2. [x] **Favourites** (docs/design/favourites.md, built 2026-10-04;
   migration `saved_items`): a heart on listing cards, listing pages and
   provider profiles; private to each customer (not even admins can read
   them), at most 500 of each; signed-out visitors sign in and come back
   with it saved; a Saved page in the account menu, where unavailable items
   stay, marked, and a removal can be undone. Later: named collections;
   counts for providers, if ever, through an aggregate that names no one.
3a. [ ] **Service availability and slots** (docs/design/service-availability.md,
   approved 2026-10-14). Providers' hours and time off, slots per Service,
   Instant or Approve, and no double booking (holds).
   - [x] Phase 1, data (2026-10-14, migration `service_availability`):
     schedules, holds and the exclusion constraint, `service_slots` /
     `service_slots_at`, `create_service_booking`, the guard's new rules;
     pgTAP `service_availability.test.sql` (clock changes included).
   - [x] Phase 2 (2026-10-15, migration `service_settings_required`): the
     provider's Availability page, each Service's mode, duration and buffer,
     the slot preview (page and sidebar), and "every Service has a mode",
     with every fixture that makes a Service; e2e journey 27.
   - [x] Phase 3 (2026-10-15, migration `service_slots_only`): the
     customer's scheduling panel, both modes on the website, emails, the
     admin view (booking mode, time and hold; the provider's availability
     summary), "Not taking bookings yet", and the request flow removed with
     the test data converted; e2e journey 2 rewritten.
   - [ ] Later in the admin: a read-only link to the provider's calendar
     view (once there is one).
   - [ ] Measure listing pages: every Service listing page view calls
     `service_next_slot` (up to six 31-day `service_slots_core` passes when
     a Service has no free time). Time a page with a busy provider and an
     empty window; cache or precompute (phase 4's `service_open_days`) if
     it slows pages down.
   - [x] Phase 4 (2026-10-15, migration `service_open_days`): dates filter
     Services by their free times (open days kept current by triggers, the
     same core live past them), soonest first, opening the panel on the
     first free day; ranges up to 31 days; e2e journey 28.
   - [ ] Re-measure dated search once there are real providers (the open
     days table and its live part), and the refresh's cost per booking.
   - [ ] Later: Google Calendar sync; team members.
3b. [ ] **Problem reports** (docs/design/problem-reports.md, approved
   2026-10-17): providers report a problem to lokl and follow it; the admin
   works them on a board.
   - [x] Phase 1, data (2026-10-17, migration `support_reports`): reports,
     the thread, notes and history (append-only), both bells, the email
     outbox, the limits (Safety never refused), the lists and the board's
     paging and search; pgTAP `support_reports.test.sql`. The bell already
     shows lokl's replies (journey 29).
   - [x] Phase 2, the provider's side (2026-10-17): Help in the menu with
     the waiting count, `/dashboard/help` (paged), the form (911 line
     always, booking search by customer name), each report's page (status
     in words, thread, reply, "This is sorted" except Safety, "Start a new
     report about this" after 30 days, lokl's replies live through the
     bell's notification); the routes, and the emails sent at once
     (`sendSupportEmails`, no message text). App test
     `support-reports.test.mts`; journey 29.
   - [x] Phase 3, the admin's side (2026-10-17, migration
     `support_admin_actions`): the board at `/reports` (four columns of
     50 with their totals and "Show more", Urgent first, filters and the
     admin search's words, "Move to…" announced with focus kept, dragging,
     a move refused if someone else moved the card first), each report's
     page (reply, "Reply and wait for their answer", private notes, the
     history), the admin bell (live, ids only), and "Open problem reports"
     on the dashboard. The admin's actions are database functions logged
     in `admin_actions`. pgTAP `support_admin.test.sql`; app tests; e2e
     journey 29 (both sides live, no reply's words in Realtime).
   - [ ] Later (design doc): customers reporting problems, photos,
     assigning a report to an admin, replying by email.
3. [x] **Reviews and star ratings** (docs/design/reviews.md, built
   2026-10-04; migrations `reviews`, `review_star_counts`): one to five
   stars and words from completed bookings, 14 days to write, edit or
   delete, one reminder; the rating line and breakdown from 3 reviews, cards
   from 3; one public reply; Report and the admin's Reviews queue under the
   written rules at `/review-rules`. Later: a "reply to your review" email
   to the customer; ratings on browse sorting; category ratings.
   "Top rated" (2026-10-12): 4.8 or higher from at least 5 reviews,
   worked out from the exact star counts (`isTopRated`), on cards and the
   listing page, explained at `/review-rules`.

## Admin dashboard

- [x] Real numbers (`admin_dashboard()`, migration `admin_dashboard`, built
  2026-10-04): GMV, commission before Stripe fees and bookings for payments
  in the last 30 days, and providers with a paid booking in the last 90,
  by the Atlanta calendar; listings awaiting review, open disputes, bookings
  that need attention, guide drafts and providers who can't be paid yet.
  Each number links to its page, filtered the same way (Bookings "paid
  between", Providers "paid since" and "can't be paid yet").

## Admin tables at scale

- [x] Server-side search, filters and pages for Bookings, Experiences,
  Services and Providers (migration `admin_search_pages`, pushed
  2026-10-03); seed and timings in `scripts/seed-admin-load.mjs` and
  `scripts/bench-admin-search.mjs` (local only).
- [x] Signed-in check of the four pages (keyboard, screen reader, phone),
  2026-10-03.
- [x] Signed-in check of the form-controls pages from the earlier commit:
  provider (listing editor, sessions, settings, a booking request) and
  customer (both booking forms). Checked by the owner, 2026-10-03.
- [x] Money totals for the filtered bookings, summed in the database
  (migration `admin_booking_totals`, pushed 2026-10-03).

## Hardening

Checks and safeguards to add, in roughly this order (2026-10-09; the first
three are done: explicit API grants, the build secrets check, and
`npm run schema:compare`).

- [x] **Who can call each function** (`function_execute_grants`,
  2026-10-10): no function has `PUBLIC` `EXECUTE`; the helpers reach
  exactly the roles that evaluate them; trigger functions reach no API role;
  new functions get no `PUBLIC` `EXECUTE`; `providers_set_slug` is security
  definer, so nobody can call `provider_slug()` to probe names.
  `function_privileges.test.sql` holds the list of security-definer
  functions allowed to reach visitors or signed-in users.
- [x] **Append-only, for every role** (`append_only_logs`, 2026-10-10).
  `admin_actions`, `booking_events`, `commission_rate_changes`,
  `guide_versions`, `job_runs` and `booking_reports` refuse updates,
  deletes and truncates for everyone, the server key and the owner
  included; an `on delete set null` key may still clear its column (a
  deleted login, guide photo, area or category). The email outboxes change
  only their delivery columns and are never deleted; `bookings` and
  `booking_finances` are never deleted. Error text stored in `job_runs` and
  `last_error` passes through `logText()`, which replaces email addresses
  and phone numbers, so the logs hold ids only. Anonymising on request: a
  migration that switches the guard off and back on, ending with
  `assert_log_guards_on()` (the procedure is in the migration's header).
- [x] **Access rules evaluated once per query, with a guard**
  (`policy_helpers_once_per_query`, 2026-10-10). Visitors' read rules
  called `listing_parents_active()` and `provider_is_public()` per row; they
  now check the row against sets computed once per query
  (`active_provider_ids()`, `active_category_ids()`, `active_city_ids()`,
  `public_provider_ids()`), with exactly the same conditions. At about 4,800
  listings a visitor's category count went from 26 ms to 2 ms and browse
  from 56 ms to 31 ms. The three reviews admin rules wrap `is_admin()`.
  `policy_guard.test.sql` fails on an unwrapped helper, a per-row helper in
  a read, update or delete rule, and row security without a rule.
- [ ] **A stored "visible" flag on listings, if browse gets slow.** Browse's
  remaining time (31 ms for 2,266 Experiences in one market, 2026-10-10) is
  the sessions read rule rechecking each session's listing. A `visible`
  column on listings, kept by triggers when a listing, its provider,
  category or city changes, would make every visitor rule a plain column
  check (and indexable). Checking each session against a once-per-query set
  instead was tried: browse 7 ms, but every single listing's sessions read
  went from 0.4 ms to 2.7 ms, growing with the number of listings.
- [x] **Lists that stop at 1,000 rows without saying so** (truncation
  sweep, 2026-10-10). Every read that could stop at the API's 1,000 rows
  without saying so is fixed, each with a test that recreated the cut-off
  first: provider bookings, the sessions panel, browse, category counts,
  the sitemap, admin disputes, the admin lists, My bookings, the jobs'
  batches (two could starve), and the Saved page's request. Two guards:
  `npm run check:reads` in CI, and `rowLimitFetch` at run time (throws in
  tests, warns in production).
- [ ] **Split the sitemap before 50,000 URLs.** One sitemap file holds at
  most 50,000; `publicSitemapEntries` lists the first 50,000 and logs an
  error past that. Split it by market or kind (@nuxtjs/sitemap supports
  several sitemaps) before a market gets near it.
- [ ] **Joins under the caller's rights that quietly drop data.** Where a
  function or view runs as the caller and joins a table that caller can't
  read, rows or values vanish without an error. Check each one shows the gap
  plainly, or only joins what the page's own permission already covers.
- [ ] **Money writes in one transaction, safe to retry.** Check how a
  booking, its finances and its payout are written: if any step is a
  separate request, a crash between them leaves half a booking, and a lost
  response followed by a retry could write twice. One database function per
  money change, an idempotency key checked against what was asked for, and
  checks at commit (the finances add up to the booking's total).
  Covered for the admin's money actions (2026-10-11): cancel or refund,
  release a payout, resolve a report for the provider each write the
  booking and its `admin_actions` row in one function, after the Stripe
  step. Still to check: the rest (checkout, payouts, the finances totals).
- [x] **A lost-response journey: booking creation** (`checkout_keys`,
  2026-10-10). The booking form sends a key per checkout attempt; a retry
  after a lost reply returns the same booking and Checkout, the same key
  with other details is refused, and a new attempt for an Experience
  session ends the customer's earlier unpaid one. E2e journey 18 drops the
  reply after the server commits. Other payment actions (accepting a
  request, cancelling, the admin's refunds) still to check the same way.
- [x] **A lost-reply check: the money actions** (`money_lost_replies`,
  2026-10-11). Accepting, declining, cancelling (customer, provider,
  session, lokl) and lokl's refunds record what they mean in Stripe before
  each call; a retry, the webhooks (`payment_intent.succeeded`,
  `.canceled`, `charge.refunded`) and the jobs finish an action from it,
  judged at the time Stripe acted (a capture before the answer-by time
  confirms after it; a refund before the 48-hour line or the start counts
  as made then). A request captured in time whose chosen time has passed
  is refunded. Retries of a finished action answer success; Stripe's
  "already done" refusals count as done; pages say done after a lost reply
  when it is. Tests: `money-retries.test.mts`,
  `money_lost_replies.test.sql`, e2e journey 20.
- [x] **E2E tests clash on the shared Stripe test account when run on several
  workers; fix before parallelising.** Found 2026-10-11: on four workers,
  test providers collided on `providers_stripe_account_id_key`. Done
  2026-10-19: each test provider gets a made-up account of its own (only
  journey 4, tagged @serial, uses the connected one); the browser tests
  run four at a time, and CI's three e2e shards and the stripe job run side
  by side (no shared concurrency group; watch for Stripe 429s, and lower
  E2E_WORKERS per shard if they appear).
- [ ] If sweep and CI ever clash on the shared Stripe test account, give the
  sweep its own connected test account in the sandbox. (The Clock sweep
  skips its journeys while a CI run is queued or in progress, but a push
  that starts CI during the sweep's journeys can still overlap them;
  accepted 2026-10-18: a rare overlap fails visibly and is re-run, better
  than making CI wait.)
- [ ] **A reload after a lost reply can hide a date.** Within 31 minutes of a
  lost reply, the booking page's spots still count the customer's own unpaid
  attempt as taken, so a date it filled shows as full and can't be chosen,
  although the server would accept a new attempt (it ends the earlier one).
  The page would need to know the signed-in customer's own unpaid attempts.
- [x] **Business time, with a guard** (2026-10-10). Every date names its
  zone: a booking's, listing's or session's market zone (`marketZone`), or
  the home zone, labelled "Atlanta time", for the admin's record-keeping
  times. `formatDate` and `formatDateTime` require the zone; `npm run
  check:dates` (CI) catches formatters without one, local getters,
  `new Date(y, m, d)`, ISO days and date-only strings. The dispute evidence
  deadline shows its time and clock. Tests: the server of the test apps in
  Tokyo, browsers in Los Angeles and (the "ahead" project) Auckland,
  journey 19 (11:30 PM Atlanta and the clock-change week, no hydration
  mismatch), unit tests in Tokyo, and a late-night email. `cities.timezone`
  is checked against real zone names (`city_time_zones`).
- [x] **Stripe errors without key fragments** (2026-10-11). Stripe's
  messages quote a key as its prefix and last four, which GitHub doesn't
  mask. `safeStripe` redacts every Stripe error where it happens (the
  server's `useStripe()`, the app tests, e2e); `logText` and
  `stripeErrorSummary` redact anything stored or logged (also emails and
  phone numbers); `installRedactingOutput` is the backstop on stdout,
  stderr and uncaught errors, in both apps' servers (production too) and
  the test runners. `secret-leaks.test.mts` checks each layer with a fake
  key. (The CI gate already fails a live key; another account's key is
  refused by the tests' sandbox check, now without printing a fragment.)
- [ ] **CI that can't quietly skip.** A shared check for scripts that must
  only run against the local stack, a test that reads `ci.yml` and fails if
  such a step runs without it, and command chains that stop at the first
  failure, with any hosted push on a step of its own after the checks.
- [ ] **Test clean-up that proves nothing is left.** After each end-to-end
  test, check every table that points at the test's providers or listings
  (from the foreign keys) for leftover rows.
- [ ] **Smaller habits.** Compare like with like in the dashboard (the same
  number of days, not month-to-date against a whole month); one shared
  constant, with a test, wherever two places must agree; a local-only demo
  seed with a clean-up that proves it removed everything; after large
  changes, bringing the docs (and the migrations skill) back in line and
  checking every Mermaid diagram still renders; and checking that every
  claimed check or trigger really exists before writing that it does.

- [ ] **Low priority: move `pg_trgm`, `pgcrypto` and `uuid-ossp` into locked
  schemas** (found 2026-10-14, with `service_availability`). On Supabase an
  extension's functions are installed by `supabase_admin` with EXECUTE for
  PUBLIC, which our migrations (as `postgres`) can't revoke, so visitors and
  signed-in users can call `pg_trgm`'s 31 functions, `pgcrypto`'s 36 and
  `uuid-ossp`'s 10. They're in the `extensions` schema, which the API
  doesn't expose, so they're reachable only from SQL a role can already
  run, not through PostgREST. `btree_gist` already lives in a schema no API
  role may use (`gist_support`); do the same for these. Note: `pg_trgm`
  backs the admin search indexes (`admin_search_pages`), so recreate those
  indexes' operator classes with the new schema and re-run
  `node scripts/bench-admin-search.mjs` to confirm they're still used.

## Automated checks

- [x] **GitHub Actions** (`.github/workflows/ci.yml`, built 2026-10-03), on
  every push to `main` and every pull request to `main`:
  - `checks`: type check, UI tests, email templates.
  - `database`: a local Supabase stack in the job (never the hosted one);
    `db:test`, the build check, both apps started from the build against
    that stack (`scripts/ci-start-apps.mjs`), `db:test:app:core` (the app
    tests without Stripe) and `db:test:realtime`. Email is off. No secrets.
  - `stripe`: `db:test:app:stripe`, only when the `stripe-sandbox`
    environment has `STRIPE_SANDBOX_SECRET_KEY`, a restricted test key for
    the Lokl sandbox (permissions in `docs/decisions.md`). Skipped without
    it; fails on anything but a test key. One run at a time.
  - Not in CI: `db:test:checkout` (waits for a person to pay on Stripe's
    page) and the five-minute token-refresh Realtime test (needs a short
    `jwt_expiry`).
- [x] **Create the restricted Stripe key** (owner) with the permissions in
  `docs/decisions.md`, run `NUXT_STRIPE_SECRET_KEY=<key> npm run
  db:test:app:stripe` locally once to confirm, then add it to the
  `stripe-sandbox` environment as `STRIPE_SANDBOX_SECRET_KEY`. Done
  2026-10-04: the `stripe` job runs all five Stripe suites, green.
- [x] **Playwright end-to-end tests** (`e2e/`, `npm run test:e2e`, built
  2026-10-04), against the local stack and the Lokl sandbox, with both apps
  built and started on 3200/3201 (never the dev servers), the browser in Los
  Angeles time to prove pages show Atlanta times, and a CI job (`e2e`) with
  the same key and conditions as `stripe`. Journeys:
  1. booking an Experience: browse, choose a date, sent to Stripe for that
     booking, back without paying (spot released), a paid booking confirmed;
     at desktop and phone size;
  2. requesting a Service (date and time pickers), sent to Stripe; the
     provider accepts a time (card captured) and declines another (hold
     released);
  3. cancelling with a refund, by the customer and by the provider;
  4. a payout: the pay-out job's route, a real test transfer, "Paid out" for
     the provider and in the admin app;
  5. the real sign-in, once per run: "Sign in to book", the emailed link
     from the local stack's Mailpit, back on the listing signed in.
  - Never paying on Stripe's own page; paid and held bookings are made
    through Stripe's API with test payment methods. The real card payment
    stays a manual check (`npm run db:test:checkout`).
  - Signing in: a password sign-in in the test code, its cookies given to
    the browser. Nothing test-only in the apps.

- [x] **Journey 9's "leave the page at once" made reliable** (2026-10-13).
  It failed once in CI, after the header search commit (passed on re-run):
  the unsave was held with `page.route`, and a request still held by
  Playwright's interception when the page left could lose the keepalive
  re-save the page sends as it goes. The unsave is now slowed with Chrome's
  network throttling instead, so nothing intercepts the page's last
  request. Checked with a deliberate break (no keepalive: the test fails).

- [ ] **A dropdown pick dropped on CI, not yet explained** (2026-10-20;
  run 39355226668, journey 27): the "From" hour menu closed with 9 still
  chosen after the test clicked "10"; the trace's snapshot before the
  click shows the list without its options yet. Not reproduced locally
  (20 runs at 20x CPU throttling). The Select opens below its trigger
  (popper), nothing scrolls, and only the 150 ms opening animation moves
  an option (~9 px); Reka cancels a release within 10 px of the trigger's
  press, which leaves the menu open, never a different value. The browser
  tests now pick like a person (`choose()` in `e2e/support/forms.ts`: wait
  until the option is shown and the menu has finished opening, click once,
  fail at once by name). **If a pick fails again with that helper,
  investigate the Select (Reka's release guard and when the list mounts)
  rather than adding a retry.**

## Staging site

A real address before the live one: `staging.hilokl.com` (website) and
`admin-staging.hilokl.com` (admin), on the testing Supabase project and the
Lokl Stripe sandbox. Test there first what needs a real address:

- [ ] **First: the job scheduler** (`pg_cron` + `pg_net` calling
  `/api/jobs/*`, including `send-emails` and, daily, `review-reminders`
  and `refresh-open-days`). Until `refresh-open-days` runs, a Service's
  open days move on only when its provider changes something (hours, a
  booking, settings): dated searches work out live, more slowly, every day
  past each Service's last refresh, and the further a search reaches, the
  more of it is live.
  Request expiry, finishing an accept whose reply was lost, withdrawals and
  payouts all depend on it; until then jobs run with `npm run job`
  (docs/design/booking-and-checkout.md; moved to the top 2026-10-11).
- [ ] **Service versions for the new projects**: when the staging and
  production Supabase projects are created, compare their service versions
  (`supabase services`, linked to each) with `supabase/service-versions.json`,
  and make the file match production's. From then on `--check-hosted`
  (`scripts/service-versions.mjs`, run first by `db:push`) checks
  production, not the testing project.
- [ ] **Admin-role migrations and the website deploy together** (from
  2026-10-18, `admin_members`): the website's admin routes name the
  admin's session in a header that `admin_role_of()` reads, and the admin
  app asks `admin_role()`. Older website code against a newer database (or
  the reverse) refuses every admin action, so a change to either side ships
  in one release: the migration first, then the website and admin app,
  with no admin actions in between. Write it into the deploy steps.
- [ ] **Edge caching of the public routes, once hosting is chosen**
  (decided 2026-10-18): `/api/public/*` answers say `Cache-Control:
  private, no-cache`, so no CDN keeps them, because a CDN can't see the
  content versions that make changes show at once (`publicCache.ts`).
  Revisit with the host: keep it so, or let the edge cache with a purge
  on each version change, and check the staging site's headers either way.
- [x] Switch to branches and pull requests (done 2026-10-19,
  `docs/deployment.md`): feature branches off `main` through pull requests,
  with `checks`, `database`, `e2e` and `stripe` required to merge.
  - [ ] (owner) Set `main`'s branch protection in GitHub and add
    `refs/pull/*/merge` to the `stripe-sandbox` environment's deployment
    branches (docs/deployment.md, Owner's settings in GitHub).
- [x] **CI doesn't run hosted's service versions** (found 2026-10-16; done
  2026-10-17: `supabase/service-versions.json`, see CLAUDE.md). CI
  runs PostgREST 16.4 and Postgres 17.11.0.004, the CLI's defaults
  (`supabase/.temp` is ignored by git, so CI has no linked versions);
  hosted and local run PostgREST 14.5 and Postgres 17.6.1.166. Storage
  differs in all three (hosted 1.80.2, local 1.77.5, CI 1.79.36). Next:
  a tracked `supabase/service-versions.json` copied into `supabase/.temp`
  before every `supabase start`, and `db:push` failing if hosted moves.
  (`database.ts` states hosted's PostgREST 14.5, checked on hosted by
  `db:types`.)
- [x] **Tests that depend on the time of day** (done 2026-10-18). Each
  failure was recreated first, then fixed:
  - Journey 2 chooses a day three days ahead (its keyboard and quick-press
    tests failed from 3 to 4 PM; "a time taken meanwhile" late on a
    Friday). The product was right: the panel offers the next free day.
  - `public-browse` 2b and `rpc-shapes` 3b take the day from the
    database's own time (they failed across Atlanta midnight); journey 19
    takes "30 hours out" from the database's clock (`data.dbNow()`).
  - November's repeated hour: slots are the first (daylight-time) ones, as
    designed, and labelled EDT or EST wherever shown (this also fixed
    `service_open_days` 3a, which failed in the clock-change week).
  - Search ordered by a rough first time once a stored one had passed:
    open days now keep their start times, and search takes the earliest
    at or after now plus the notice (`search_exact_first_time`).
  - `check:clock` (CI): server utilities take `now` as a parameter, or say
    why they use the real time. Browse takes `now`.
  - The clock sweep: `npm run test:clock` (the time rules at eight fixed
    instants, two device zones), and the scheduled Clock sweep workflow,
    which runs the real-clock tests at the risky times of day and nightly
    across midnight, never on a push. Since 2026-10-19, `test:clock` checks
    every real hour of a Wednesday, a Saturday and both clock-change days
    (at 5 past and 5 to, 192 instants, plus the 8 named edges) on every
    push, and `slot_instants.test.sql` (in `db:test`) checks the slot core
    at the same 192 instants against the expected wall-clock grid.
- [ ] **Possible later step: give the database's time rules a `now`
  parameter.** 37 functions read `now()` directly, so they can only be
  tested at the hours the scheduled sweep happens to run; the slot core,
  `queue_review_reminders` and `session_time_label` already take the time
  and are checked at every hour. Not planned for now (decided 2026-10-19).
  - Journeys 27 and 28, `booking-emails` and `booking-checkout` couldn't be
    made to fail by the clock; left as they are.
- [ ] **Pages no browser journey opens yet** (found 2026-10-19 by recording
  which pages a full run reaches; `check:journey-pages` lists them with
  their reasons and fails on any new one): the website's guide page
  (`/[market]/guides/[slug]`), `/dashboard/services` and `/help/customers`;
  the admin app's categories, markets and areas, the sign-in link's
  `/confirm`, a guide's preview, a listing's page, the Services and
  Experiences lists, settings and users. Add journeys for those worth it
  (the guide page and the admin's listing pages first) and take each off
  the list as it gains one.
- [ ] Run the end-to-end tests in WebKit (Safari's engine) too, against the
  staging site: it needs HTTPS. Production cookies are Secure, and WebKit
  refuses Secure cookies on plain-http localhost (Chromium accepts them), so
  WebKit can't run against the local build.
- [ ] Build the website with the Supabase URL of the project it will run
  against, or set `NUXT_PUBLIC_SUPABASE_COOKIE_PREFIX` where it runs: its
  sign-in cookie's name is fixed at build time from that URL, and a build
  pointed at another project at run time reads every visitor as signed out
  (found 2026-10-04 by the end-to-end tests; `scripts/ci-start-apps.mjs`
  sets it for the local stack). The admin app's cookie has its own fixed
  name (2026-10-17); never set the variable for it, or the two apps share a
  session on localhost.
- [ ] Hosting for both apps on those addresses, over HTTPS.
- [ ] Supabase auth URLs for staging: Site URL and the `/confirm` redirects
  on both addresses.
- [ ] Photo upload from an iPhone (any browser there uses Apple's engine):
  check the stored files are a JPEG or WebP photo plus a `.card.jpg` or
  `.card.webp` about 600px wide, with `card_path` set. Also one from Chrome,
  kept, to confirm its card copy is WebP. (Safari on a Mac was checked on
  2026-09-30: `.card.jpg`, 600px. Removing a photo deletes both files.)
- [ ] The Stripe webhooks, registered for staging: `/api/stripe/webhook`
  ("Events on connected accounts", `account.updated`) and
  `/api/stripe/webhook-payments`. (The connected-accounts listener hasn't
  been tested locally yet either.)
- [ ] Production payments webhook must subscribe to every event the route
  handles, including disputes, transfer.reversed and (since 2026-10-11)
  `payment_intent.succeeded`, which finishes an accept whose reply was lost
  (the list is in the route's header comment and
  docs/architecture/booking-and-payments.md).
- [ ] The Nuxt Image provider (`image.provider` in the shared layer, `none`
  today): the host's image service, or Supabase image transformations
  (docs/design/browse-and-listing-pages.md, Images).
- [ ] The admin's calls to the website over HTTPS across the two addresses:
  `NUXT_ADMIN_ORIGIN=https://admin-staging.hilokl.com` on the website,
  `NUXT_PUBLIC_WEBSITE_URL=https://staging.hilokl.com` on the admin; rerun
  the admin request checks against it.

- [x] **Google sign-in, local** (the Testing-mode client, 2026-10-11):
  linking checked on localhost with a real Gmail account. Code first (a
  listing saved), then "Continue with Google": one account, with an email
  and a Google sign-in, and the saved listing still there (read-only
  check, counts only). Google first, then a code: one account too, with
  only the Google sign-in attached (Supabase signs a code in by the
  account's email without adding an email sign-in), so "both attached" is
  only expected when the code came first.
- [ ] **Google sign-in, staging** (the same client): add the staging origin
  to the client and `NUXT_PUBLIC_GOOGLE_CLIENT_ID` to staging's settings,
  then repeat the linking check there with a real Google account (yours:
  it can't be done from a test): code first, then Google, the same account
  with its bookings and saved items, and again for an email that asked for
  a code but never used it. Also a keyboard-only and a VoiceOver pass over
  Google's real button in the dialog.
- [x] **Clear a session whose user no longer exists** (2026-10-12). Once
  per page load, while signed in, the website asks Supabase for the user;
  if the user or session is gone, it signs out in that browser and shows
  the page signed out (`plugins/clear-stale-session.client.ts`). Journey 25
  checks it, a deleted user's expired session, and a signed-in provider
  whose own listings are in the homepage's carousels.

## Launch prep

On hilokl.com: the website at `https://hilokl.com`, the admin at
`https://admin.hilokl.com`.

- **Domain and hosting**
  - [ ] Hosting and DNS for `hilokl.com` and `admin.hilokl.com`.
  - [ ] `NUXT_PUBLIC_SITE_URL=https://hilokl.com`;
    `NUXT_ADMIN_ORIGIN=https://admin.hilokl.com` (website);
    `NUXT_PUBLIC_WEBSITE_URL=https://hilokl.com` (admin).
  - [ ] Supabase auth URLs: Site URL `https://hilokl.com`; redirect URLs
    `https://hilokl.com/confirm` and `https://admin.hilokl.com/confirm`.
- **Email**
  - [ ] A separate Resend account for lokl, so its quota can't block The
    Reserve's emails (they share a Resend team today, whose daily quota ran
    out during the part 7 walkthrough on 2026-10-02), on a paid plan.
  - [ ] Verify `hilokl.com` in Resend.
  - [ ] Send from `hello@hilokl.com`: sign-in emails (Supabase → Auth → SMTP
    sender) and booking emails (`NUXT_EMAIL_FROM`), instead of
    `lokl@innatetheory.com`.
  - [ ] Support address `help@hilokl.com` on a business email account for
    hilokl.com (for example Google Workspace), **not a forward to a personal
    Gmail** (decided 2026-10-17: the privacy policy names the provider that
    holds support emails). Reply-to for booking emails
    (`NUXT_EMAIL_REPLY_TO`) and the address on pages
    (`NUXT_PUBLIC_SUPPORT_EMAIL`).
  - [ ] `NUXT_EMAIL_MODE=send` in production.
  - [ ] Production's `NUXT_PUBLIC_SUPPORT_EMAIL` is `help@hilokl.com` (the
    pages name it; without the setting they fall back to it).
- **Public website pages** (docs/design/website-pages.md)
  - [x] Nothing loaded from other sites; Google Analytics, measurement only
    (2026-10-17).
  - [x] Help centre at `/help`: 15 articles (6 for customers, 9 for hosts),
    search, facts from the code (2026-10-17).
  - [x] The information pages (2026-10-18): About, How lokl works, How
    hosting works, Fees and payouts (rates read live), Contact, Safety,
    Cancellation policy, Accessibility. Review the Accessibility page's
    "What isn't right yet" whenever one of its gaps is closed.
  - [x] About rewritten with real sections (2026-10-18); its numbers show
    once Atlanta has at least 5 categories and 5 neighborhoods.
  - [ ] Replace the About page's marked placeholder ("Why lokl exists":
    why lokl was built, and why Atlanta) with the founder's own words, and
    an optional photo with alt text, removing the `LAUNCH-PLACEHOLDER`
    marker with it. Until then a deployable build fails
    (`scripts/launch-placeholders.mjs`); `build:check` lists it.
  - [ ] `LOKL_ALLOW_PLACEHOLDERS` is **never set** on staging or
    production (it lets a build through with placeholders; only
    `build:check` sets it).
  - [x] Legal drafts (2026-10-18): the Privacy Policy (`/privacy`), the
    Terms of Use (`/terms`) and the Terms for hosts (`/terms/hosts`),
    written from what the code does, each marked "Draft: to be reviewed by
    a lawyer before launch".
  - [ ] A lawyer reviews the three drafts and writes their marked parts
    (liability, disputes, governing law, which privacy laws apply, cookie
    consent, Stripe's Connected Account Agreement); the accountant sets
    the retention periods and tax wording. Replace "[lokl's legal name]",
    "[address]" and "[hosting provider]" once known. Every one of these
    carries `LAUNCH-PLACEHOLDER`, so a deployable build fails until done.
  - [x] About's "We don't sell your personal information" links to the
    Privacy Policy, which says the same (2026-10-18).
  - [x] The footer (four columns) and the sign-in line "By continuing, you
    confirm you're 18 or over and agree to lokl's Terms and Privacy
    Policy", on the sign-in page and dialog (2026-10-18).
  - [x] Providers' access to customers' email, phone and address ends 30
    days after the booking (2026-10-18; migration `contact_access_30_days`,
    pgTAP `bookings_access` 6f-6k, `contact-access.test.mts` keeping the
    rules' interval and `CONTACT_ACCESS_DAYS` the same). The Terms for
    hosts and the Privacy Policy now state it as built.
- **Google Analytics** (decided 2026-10-17; docs/decisions.md)
  - [ ] A Google Analytics 4 property for hilokl.com; its measurement id in
    `NUXT_PUBLIC_GTAG_ID` on **production only**, never on staging, so test
    traffic never mixes with real numbers (a separate property for staging,
    if it's ever wanted).
  - [ ] In Google Analytics' admin: data retention 2 months (the shortest);
    Google Signals off; ads personalisation off; granular location and
    device data off; every data-sharing setting off; no Google Ads links.
  - [ ] Enhanced measurement **all off** (page changes from browser
    history, scrolls, outbound clicks, site search, form interactions,
    video, file downloads): Google's script would otherwise send events
    and page addresses lokl doesn't clean.
  - [ ] The privacy policy's analytics section published before the id is
    set (docs/design/website-pages.md).
- **Database**
  - [ ] Run `npm run schema:compare` before every deploy: zero differences
    between the migrations and the hosted (and later production) database.
  - [ ] After 2026-10-30 (when the Supabase CLI drops it), delete
    `auto_expose_new_tables` from `supabase/config.toml`; every grant is in
    the migrations since `explicit_api_grants`.
- **Sign-in**
  - [ ] Once the terms and privacy policy exist, show "By continuing, you
    agree to lokl's Terms and Privacy Policy" in the sign-in dialog, with
    links.
  - [ ] **Google sign-in in production** (built 2026-10-11, hidden until a
    client is set): needs the privacy policy (and terms) at public
    hilokl.com addresses first, which Google's branding verification asks
    for, and the policy must say Google sign-in shares the person's name
    and photo with lokl. Then a production client listing only
    `https://hilokl.com`, the production Supabase project's Google provider,
    and the consent screen published to "In production".
  - [ ] In the production Supabase project: set **both** sign-in email
    templates from `supabase/templates/sign-in.html`: Magic link (an
    address that already has an account) and Confirm signup (a first-time
    address). With only one set, the other kind of person gets Supabase's
    default email instead of lokl's code email.
  - [ ] In the production Supabase project: Email OTP length 6 and
    expiration 600 seconds, and "Token verifications" at 30 per 5 minutes
    (docs/design/sign-in-with-code.md).
- **Anthropic**
  - [ ] Create a separate production Anthropic API key for the admin app
    (`NUXT_ANTHROPIC_API_KEY`), apart from the development one.
- **Stripe**
  - [ ] Live keys (see "Separate production environment" under Open
    decisions).
  - [ ] Production webhooks: `https://hilokl.com/api/stripe/webhook`
    ("Events on connected accounts", `account.updated`) and
    `https://hilokl.com/api/stripe/webhook-payments`.
  - [ ] Card statement descriptor `HILOKL.COM` (5 to 22 characters), with
    `LOKL` as the shortened descriptor; Connect payout statement descriptor
    `LOKL` (what providers see on bank statements). The sandbox's card
    setting couldn't be changed through the API, and isn't needed in test
    mode.
  - [ ] Business website `https://hilokl.com` in Stripe's public details.
- **Database and jobs**
  - [ ] Expose the `private` schema in the production project's API settings
    (service role only: the migration revokes it from everyone else).
  - [ ] Turn on the job scheduler, including `send-emails`.
- **Site**
  - [ ] On `hilokl.com`, check `robots.txt` allows crawling and points to
    `/sitemap.xml`, and that the sitemap lists only public pages. (In
    development the SEO module sends `Disallow: /` on purpose.)
  - [ ] Replace the Nuxt favicon in both apps (`apps/website/public/favicon.ico`,
    `apps/admin/public/favicon.ico`) with lokl's, once there's a logo.
  - [x] Clear cached browse pages as soon as a listing is taken down or
    unpublished, and provider pages on a suspension (done 2026-10-18:
    content versions, `publicCache.ts`; spots and open days still follow
    60 seconds).
  - [ ] UX polish pass across the public pages: font sizes, spacing and
    visual design.
- **Blockers for live payments** (sandbox testing can go ahead)
  - [ ] Accountant consultation on Georgia marketplace sales tax, commission
    taxability, holding provider funds, 1099-K and business setup.
  - [ ] Customer terms, provider terms (including Stripe's Connected Account
    Agreement, and the review rules' no-incentives rule: no discounts,
    refunds or gifts for reviews, no asking only happy customers), privacy policy and cancellation policy page, drafted then
    reviewed by a marketplace lawyer.
- **Personal data**
  - [ ] Design for data deletion requests: what happens to a customer's
    bookings, contact details, addresses and login when they ask lokl to
    delete their data. (Today a login with bookings can't be deleted, and
    the logs can only be changed by a migration; see `append_only_logs`.)
    The Privacy Policy's "How long we keep it" and "Your choices and
    rights" sections depend on this design: they only propose periods and
    promise to act on requests, and stay marked `LAUNCH-PLACEHOLDER` until
    it's built.
- **Staff access**
  - [ ] Admin roles before hiring anyone (owner and support), enforced in
    the database, with owner approval for suspensions, payout releases and
    large refunds, alerts, limits, and logging access to contact details.
    Staff never get Supabase, Vercel, GitHub or full Stripe access.
    **Designed and approved 2026-10-18:**
    [docs/design/admin-roles.md](design/admin-roles.md) (roles read live
    from `admin_members`, the authenticator second factor enforced in the
    database, the Team page, recovery and break-glass). Building in the
    cutover's order: 1. authenticator MFA on (done 2026-10-18; enabled on
    hosted, confirmed in the dashboard); 2. the admin app's set-up and
    second-step pages, optional (done 2026-10-18: `/security`,
    `/security/verify`); 3. the owner enrols two authenticators (done
    2026-10-18); 4. the migration (built 2026-10-18, waiting for
    `db:push`); 5. in four parts: 5a, the owner's areas and the team
    (the Team page at `/team`: invite by email, join on `/join`, change
    a role, reset authenticators, remove; every change logged and sent
    to every owner's bell and inbox; built and pushed to hosted 2026-10-19); 5b, requests (support asks, the
    owner approves or declines; the $150 refund limit on what's left of
    the charge; built 2026-10-19, pull request open, `db:push` after the
    merge); 5c, contact views and daily limits; 5d, settings for the
    limits and the remaining alerts. After one release, remove `app_metadata.role` from the
    owner's login (unused since step 4).
  - [ ] **An authenticator code works more than once** (found 2026-10-19):
    Supabase Auth v2.197.0 (hosted and local) accepts a code from the
    previous, current or next 30-second window and records none as used,
    so the same code works again for up to about 90 seconds (seen on the
    local stack; the hosted version's code is the same, not tested live,
    which would need a hosted test login). The MFA verification hook
    can't refuse a reused code (it gets the factor and whether the code
    was valid, not the code or its window) and is on the Team and
    Enterprise plans only. **Decided 2026-10-19:** accepted for now (the
    emailed code comes first, a removal ends sessions at once, step 5
    adds alerts; docs/design/admin-roles.md, The second factor); to be
    reported to Supabase privately by the owner, through their disclosure
    programme (HackerOne), not a public issue (report drafted
    2026-10-19); the hook only if lokl
    moves to the Team plan (one valid code per authenticator per 90
    seconds; a refusal signs the person out everywhere). Revisit when
    Supabase records used codes, or answers the report.

## Notifications

- [ ] Booking reminder emails the day before, to customer and provider
  (docs/design/booking-and-checkout.md, answer 8).
- [ ] Manual check on the hosted project: leave a provider tab in the
  background for 75 minutes, then take a listing down; the bell updates.
- [ ] Cleanup job: delete read notifications older than six months.
- [ ] Notification history beyond the 20 newest (See all / Show older), if
  providers or admins ask for it. Both bells load the newest 20 and count
  every unread one in the database (2026-10-17).
- [ ] Admin notifications, such as new Experiences waiting for review (also
  makes the review queue update live).
- [ ] Email providers when a listing is approved, rejected or unpublished.
  Until then, the dashboard overview shows "N listings need your attention"
  when any listing is rejected or unpublished.

## Open decisions

| Decision | Options | Needed by |
| --- | --- | --- |
| Separate production environment | Its own Supabase project and live Stripe account, apart from the testing ones | Before launch |
| Several team members per business? | Members table later | Before multi-staff providers join |
| Brand (logo, colours) | Not set (name: lokl; domain: hilokl.com) | Launch |
| Sales contractor's commission | Flat bonus, revenue override, or hybrid; what counts as "signed" | Before outreach |
| How much admin to build before launch | Full now, or minimal + the Supabase table editor | Ongoing |
| Stripe Accounts v2 | Stripe's SDK recommends Accounts v2 over the current `accounts.create({ type: "express" })` (v1), which still works | Later; before launch at the latest |

## Later ideas

- "Don't see your area? Tell us" link next to the area picker.
- Area pages such as `/atlanta/decatur`, once areas have enough listings to stand as pages (docs/design/browse-and-listing-pages.md).
- Optional note to the customer when declining a request (stored on the booking, sent in the decline email).
- Track provider cancellations and show patterns to the admin.
- Partial refunds (for example half, for a partly missed booking). Needs its own payout maths. When admins can make them, the commission rule becomes proportional (commission × the share not refunded), on both the dashboard and the Bookings totals (`admin_bookings_page`). Today a partly refunded booking keeps its whole commission.
- Record Stripe's actual fee per charge, from its balance transaction, so the dashboard can later show true net revenue (today it shows commission before Stripe fees).
- Accounting report by period, dating refunds by when they happened rather than by the original payment, for the accountant. (The dashboard subtracts refunds from the bookings paid in its range, whenever the refund was made.)
- Option to cancel and still pay the provider, when the cancellation isn't their fault.
- Deduct money owed from a provider's future payouts (a reversal that failed after a payout).
- A narrower provider view of `booking_finances`: providers can read their bookings' Stripe ids, though no page shows them (docs/design/booking-and-checkout.md).

## Loose ends

- The machine runs Node 22.12; the repo's `engines` asks for 24 or later. `.nvmrc` now says 24, so `nvm use` picks the right version.
- `packages/types/src/providers.ts` is hand-written; replace it with the generated types (`database.ts`) when it's next touched.

## Done

<details>
<summary>Earlier work, kept for reference</summary>

### Move to lokl's own Supabase project (2026-09-27)

lokl left the Supabase project it shared with the blog. The new project has 1
admin, and the provider walkthrough passed there. In the old project, the
cleanup script removed lokl's table, functions, migration row and admin role;
its SMTP is off, lokl's test logins and the old Resend key are deleted, and the
project is renamed. Done: the new project and both apps' `.env` files; the CLI
relinked and the schema pushed; auth URLs, SMTP through Resend, rate limits
and email templates; the admin role; `TBLS_DSN` in the root `.env`; the
provider walkthrough rerun; the old project cleaned up
(`scripts/cleanup-old-supabase-project.sql`).

### Owner to-dos

- [x] Link the Supabase project and apply the providers migration.
- [x] `TBLS_DSN` in the root `.env` (Session pooler connection string), for
  `db:docs`.
- [x] Supabase auth URLs for ports 3100 and 3101.
- [x] Make yourself admin: the SQL is in CLAUDE.md ("Granting admin").
- [x] Walk the provider flow; commit the work once reviewed.
- [x] Product name and domain: lokl, at hilokl.com (2026-10-03). The brand is
  under "Open decisions".

### Walkthrough findings (2026-09-27)

- [x] Stripe gets the business name (`business_profile.name`).
- [x] Cities are an admin-managed list, not free text.
- [x] Apps refuse to start on a taken port (`scripts/check-port.mjs`).
- [x] The webhook listener and the auth email sender moved to "Staging site"
  and "Launch prep".

### Product steps 1 and 2 (categories and listings)

From `docs/design/categories-and-listings.md`, each one migration plus tests:
cities and service areas (`db3a133`); categories and the admin Categories and
Cities pages (`3dc4ee6`); listings, addresses and service areas
(`a4a624b`, `81658a0`, `0e13d4b`); photos and the storage bucket; Experience
sessions; the admin Listings page and review queue. All 2026-09-27, each
walkthrough passed.

### Also done

- [x] An admin login can't own a provider (2026-09-28,
  `20260928032853_admin_owns_no_provider`; docs/decisions.md).
- [x] Provider in-app notifications and live updates
  (`docs/design/notifications.md`, 2026-09-28).
- [x] The homepage is lokl's own markup, with nothing loaded from other
  sites (2026-09-30).
- [x] The dashboards' phone menu (2026-09-30).
- [x] Generated types wired into both apps' `supabase.types` (2026-10-02).
- [x] The website's unused `h3` v2 removed (2026-10-02).
- [x] Settled decisions: Services are request and confirm; one platform-wide
  cancellation policy (docs/decisions.md).
- [x] Sign in with an emailed 6-digit code without leaving the page, on the
  website (dialog and `/login`) and the admin app; the link still works
  (docs/design/sign-in-with-code.md, 2026-10-04). Hosted dashboard settings:
  see the design's "The email".

</details>
