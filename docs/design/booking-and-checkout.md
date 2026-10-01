# Booking and checkout

Status: approved design · 2026-09-30
Product build step 4. Customers book Services (request, then the provider accepts) and Experiences (pay straight away); lokl takes payment, holds it, and pays the provider after the booking has happened. Stripe test mode only (the Lokl sandbox) until the launch-prep blockers are cleared: the accountant consultation and the terms and policies (`docs/TODO.md`).

## Decisions already made

From the owner, 2026-09-30. Points that don't fit the code or Stripe as written are flagged under each, and gathered in "Flags" below.

1. **Customers sign in to book**, with the same emailed sign-in link as providers. A customer is a login with no provider record.
2. **Services: request and confirm.** The customer picks a preferred date and time, adds notes (and their address for "I come to you"), and goes through Stripe Checkout, which places a hold on the card. The provider accepts or declines within 48 hours. Accepting charges the card; declining, or no answer, releases the hold.
3. **Experiences:** the customer picks a session and the number of people and pays at once. Spots are checked at payment, so the last spot can't be sold twice.
4. **Payouts after the booking date:** lokl holds the money and releases it to the provider once the Service or Experience has happened.
5. **One cancellation policy:** full refund if the customer cancels 48 hours or more before; no refund within 48 hours; always a full refund if the provider cancels. Customers see it before paying.
6. **After booking:** confirmation emails to customer and provider through Resend; the customer can read the exact address; both get a bookings page. No messaging yet; the booking carries the customer's notes.
7. **Commission:** 12% Services, 20% Experiences; the provider absorbs it; lokl pays Stripe's fee. Rates are admin-editable settings, and each booking records the rate that applied.

## Answers to the open questions

Decided 2026-09-30; the sections below include them.

1. **Email sender:** `lokl@innatetheory.com` (Resend has `innatetheory.com` verified; sign-in emails already use it) until lokl has its own domain.
2. **Who can book:** anyone signed in, except their own listings.
3. **Service times:** the customer offers up to three preferred times; the provider accepts one of them.
4. **What the provider sees:** the customer's name and notes on the request; their email and optional phone only once the booking is accepted or confirmed.
5. **Payout:** 24 hours after the booking ends.
6. **Limits:** Service requests need at least 24 hours' notice. Experience bookings are limited by spots left, at most 10 people per booking by default (a per-listing maximum can come later).
7. **No-shows:** a customer who doesn't show gets no refund. A provider who doesn't show is reported by the customer before the payout; the report holds the payout until the admin refunds.
8. **Reminder emails:** later (`docs/TODO.md`).
9. **Customer bookings:** `/account/bookings` shows anyone's own bookings as a customer; bookings of a provider's listings stay in the dashboard.
10. **Refund fees:** Stripe keeps its processing fee on refunds, and lokl absorbs it (`docs/decisions.md`).

## Further decisions

Also decided 2026-09-30.

11. **Late customer cancellations:** a customer who cancels within 48 hours gets no refund, and the provider still receives their share at payout. (In the database, such a booking is `cancelled` but can still become `paid_out`.)
12. **Sessions with bookings** can't be moved to another time; they can only be cancelled, with full refunds.
13. **When a listing comes down** (the provider unlists it, the admin takes it down, or the provider is suspended): pending requests are declined automatically and their holds released; unpaid checkouts expire; confirmed bookings stay valid unless the admin cancels them, with full refunds.
14. **Admin calls to the website** carry the admin's sign-in token explicitly, and the website accepts them only from the admin app's address (see "Admin actions on the website").
15. **Failed transfers:** if a provider's Stripe account can't receive a transfer, the payout job holds it and flags it on the admin's "needs attention" list.
16. **The hosted scheduler stays off** until production hosting exists; in development, jobs run with `npm run job`.

## Stripe approach

### Which charge type

Holding money until after the booking date rules out the usual marketplace default:

| Charge type | Where the money sits | Holding until after the date | Fit |
| --- | --- | --- | --- |
| Direct charges | The provider's account | Not possible; the provider is paid at once | No |
| Destination charges | Moves to the provider's account at payment | Only by switching the provider's payouts to manual and paying out later; the money is already in their Stripe balance, and lokl manages every provider's payout schedule | Possible, awkward |
| **Separate charges and transfers** | lokl's account | Yes: lokl charges, keeps the money, and sends a **transfer** to the provider when it's due | **Recommended** |

**Recommendation: separate charges and transfers.** lokl charges the customer on its own account, then, after the booking has happened, creates a transfer of the provider's share to their connected account, linked to the original charge (`source_transaction`) so it only moves money that has actually arrived. This keeps lokl in control until the booking has happened, makes refunds before payout simple (nothing to claw back), and needs no change to providers' accounts. The existing Express onboarding, `syncStripeAccount()` and the payouts-ready check all stay as they are.

What it means for lokl:

- **lokl is the seller of record.** The customer's statement shows lokl; disputes (chargebacks) are against lokl; lokl pays Stripe's fee from its own balance, which matches decision 7.
- **The provider's share** is total minus commission, transferred in one go. lokl's commission is what stays behind; there's no "application fee" with this charge type.
- **After the transfer, the provider's own payout schedule applies** (Express default: daily, a couple of days after funds land). So "paid after the booking" means "transferred after the booking"; the money reaches their bank a few days later.
- **Holding funds has legal and accounting sides** (how long lokl may hold customer money, and whether that needs a licence), which is why it's on the accountant and lawyer list. Stripe also has limits on how long and how funds can be held for connected accounts; check them against current Stripe docs and the platform agreement before going live. Flag 4.

### Money flow by kind

**Services (request and confirm)**

1. Checkout Session in `payment` mode with `payment_intent_data.capture_method = "manual"`: the card is authorised (a hold), not charged.
2. The provider accepts: the server **captures** the PaymentIntent, and the card is charged.
3. The provider declines, or 48 hours pass: the server **cancels** the PaymentIntent, and the hold is released.
4. After the booking date: transfer the provider's share.

Card holds last about 7 days for most cards; 48 hours is well inside that. If a capture fails (the hold expired or the card was cancelled), the booking can't be accepted and the customer is told.

**Experiences (pay now)**

1. When the customer starts checkout, the server **reserves** their spots for the session (a pending booking), then creates a Checkout Session that expires in 30 minutes (Stripe's minimum).
2. Payment completes (`checkout.session.completed`): the booking is confirmed.
3. The session expires or is abandoned (`checkout.session.expired`): the reservation is released.
4. After the session date: transfer the provider's share.

**Refunds**

- Before the transfer (the usual case, since transfers happen after the date): refund the charge in full. Nothing to recover from the provider.
- After the transfer (rare: a dispute or a late problem): refund the charge and **reverse the transfer**. A reversal can fail if the provider's balance is empty; the admin then sees it as money owed (Flag 7).
- Stripe doesn't return its processing fee on refunds, so lokl absorbs it on every refunded booking (Flag 6).

## Tables

All server-written. Signed-in users only read. Money tables are never deleted (CLAUDE.md).

### commission_rates

| Column | Notes |
| --- | --- |
| `kind` | primary key: `service` or `experience` |
| `rate_bps` | basis points: 1200 = 12%, 2000 = 20%; 0 to 5000 |
| `updated_at`, `updated_by` | who last changed it |

Seeded with 1200 and 2000. Admin-editable from the admin app (an admin-only reference list, like categories). Bookings copy the rate when they're created, so changes never touch past bookings.

### bookings

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `kind` | `service` or `experience` |
| `listing_id`, `provider_id` | restrict |
| `customer_id` | the login that booked; restrict |
| `session_id` | Experiences; restrict |
| `status` | see Booking states |
| `preferred_times` | Services: one to three times the customer offers, each at least 24 hours ahead |
| `starts_at`, `ends_at` | Services: the preferred time the provider accepts, set on acceptance; Experiences: the session's start, copied. `ends_at` adds the listing's duration |
| `customer_name` | From checkout; the provider sees it on the request |
| `party_size` | 1 for Services; 1 to 10 for Experiences, and never more than the spots left |
| `unit_price_cents`, `total_cents`, `currency` | copied from the listing at booking time |
| `commission_rate_bps`, `commission_cents`, `provider_amount_cents` | the rate that applied, and the split |
| `customer_notes` | up to 1,000 characters |
| `respond_by` | Services: when the 48-hour window closes |
| `reserved_until` | Experiences: when an unpaid reservation lapses |
| `confirmed_at`, `payout_due_at` | when it was accepted or paid; when the transfer may happen: 24 hours after `ends_at` |
| `problem_reported_at`, `problem_note` | the customer reports that the provider didn't show; holds the payout |
| `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_transfer_id` | |
| `refunded_cents`, `refunded_at` | |
| `cancelled_by`, `cancelled_at`, `cancel_reason` | `customer`, `provider`, `admin` or `system` |
| `created_at`, `updated_at` | |

### booking_contacts

The customer's email and optional phone. Separate from `bookings` because access is per row: the provider reads them only once the booking is accepted or confirmed (answer 4); the name stays on `bookings`, visible on the request.

### booking_addresses

The customer's address for "I come to you" Services. Kept out of `bookings` for the same reason listing addresses are separate: access is per row. Readable by the customer always, and by the provider only once the booking is accepted.

### booking_events

One row per status change (who, from, to, when). It's the start of the admin audit log in `docs/TODO.md`, and it makes disputes answerable.

### Changes to existing tables

- **listing_addresses:** a new read rule lets a customer with an accepted or confirmed booking read that listing's address.
- **experience_sessions:**
  - Bookings point at sessions with `restrict`, so a session with bookings can't be deleted, only cancelled, which refunds its bookings through a server route.
  - Capacity can't drop below the spots already booked or reserved (trigger).
  - A `session_spots_left(session_id)` function gives the public "3 spots left".
- **notifications:** new kinds for providers: `booking_requested`, `booking_confirmed`, `booking_cancelled`. The bell and live updates work unchanged.

### Booking states

| Status | Services | Experiences |
| --- | --- | --- |
| `pending_payment` | In Checkout | Spots reserved, in Checkout |
| `requested` | Card on hold, waiting for the provider | — |
| `confirmed` | Accepted and charged | Paid |
| `declined` | Provider said no; hold released | — |
| `expired` | No answer in 48 hours, or Checkout abandoned | Checkout abandoned |
| `cancelled` | By customer, provider or admin; refund per policy | Same |
| `completed` | The booking time has passed | Same |
| `paid_out` | Provider's share transferred | Same |

Every change goes through the server (status is never written by users), checked against the current status so a double click acts once, and logged in `booking_events`.

### Access rules

| Table | Customer | Provider | Admin | Server |
| --- | --- | --- | --- | --- |
| commission_rates | Read | Read | Read and write | Read |
| bookings | Read own | Read their listings' | Read all | Writes everything |
| booking_contacts | Read own | Read once accepted or confirmed | Read all | Writes |
| booking_addresses | Read own | Read once accepted | Read all | Writes |
| booking_events | Read own bookings' | Read their bookings' | Read all | Writes |

No insert, update or delete for signed-in users on any of these. pgTAP tests cover each, with a break each, as before.

### Spots: no last spot sold twice

`session_spots_left` = capacity minus the party sizes of confirmed bookings and of unexpired pending reservations. Starting checkout calls a database function that locks the session row (`for update`), checks spots, and inserts the pending reservation in one transaction. Two customers starting checkout for the last spot at the same moment: one gets it, the other is told "Someone just booked the last spot." This is the reason for reserving at checkout start rather than checking at payment (Flag 1).

## Server routes (website)

The Stripe secret stays on the website's server (CLAUDE.md). Admin actions that touch Stripe call these routes with the admin's session; the website checks the admin role.

| Route | Who | What |
| --- | --- | --- |
| `POST /api/bookings/service` | customer | Validates the listing, time, notes and address; creates the booking (`pending_payment`) and a manual-capture Checkout Session; returns its URL |
| `POST /api/bookings/experience` | customer | Reserves spots, creates the booking and a Checkout Session; returns its URL |
| `POST /api/bookings/:id/accept` · `decline` | provider | Captures or cancels the hold |
| `POST /api/bookings/:id/cancel` | customer, provider | Applies the policy: refund or not; releases or refunds |
| `POST /api/sessions/:id/cancel` | provider | Cancels a session with bookings; refunds each in full |
| `POST /api/admin/bookings/:id/refund` · `cancel` | admin | Refund or cancel any booking, with a reason |
| `POST /api/stripe/webhook-payments` | Stripe | See Webhooks |
| `POST /api/jobs/:name` | the scheduler | See Jobs |

Checkout's success and cancel URLs come from `runtimeConfig.public.siteUrl`. Every Stripe call that creates something (Checkout Session, capture, refund, transfer) passes an idempotency key built from the booking id and the action, plus an attempt number, never a fixed key per record (CLAUDE.md).

## Jobs

Three timed jobs, all small, idempotent (safe to run twice) and safe to miss once.

| Job | Every | Does |
| --- | --- | --- |
| `expire-requests` | 5 minutes | Services past `respond_by` still `requested`: cancel the PaymentIntent (release the hold), mark `expired`, email the customer |
| `release-reservations` | 5 minutes | Experiences past `reserved_until` still `pending_payment`: expire the Checkout Session if it's still open, mark `expired` |
| `pay-out` | hourly | Bookings `confirmed` (or cancelled late by the customer, with no refund) with `payout_due_at` passed, no open dispute, no problem report and no earlier failed transfer: mark `completed`, transfer the provider's share, mark `paid_out`. If Stripe refuses the transfer (the account can't receive it), record `payout_failed_at` and the reason, and leave it for the admin's "needs attention" list (decision 15) |
| `withdraw-unavailable` | 5 minutes | Bookings `requested` or `pending_payment` whose listing is no longer live, or whose provider is suspended: release the hold or expire the checkout, mark `declined` or `expired` (by `system`), email the customer (decision 13) |

`payout_due_at` is 24 hours after the booking's end (start plus duration; for a Service with no duration, its start), so a provider no-show can be reported before the money moves (answers 5 and 7).

**How they run.** The jobs need the Stripe secret, which only exists on the website's server. So each is a server route (`/api/jobs/<name>`) that checks a shared secret header, and something calls it on a timer. The recommendation for production is Supabase's own scheduler: `pg_cron` with `pg_net` calls each route on its schedule. It works with any host and needs no extra service, and the job secret lives in Supabase's vault, not in a migration. If the host chosen later has its own scheduler (for example Vercel Cron), the routes stay the same and only the caller changes. Each run logs what it did; failures surface in the admin's Bookings page.

**Not enabled until production hosting exists** (decision 16): there's no public address for the scheduler to call, and nothing should run against the hosted database on a timer before then. In development, jobs run with `npm run job -- <name>`, which calls the route on `localhost:3100` with the secret from the website's `.env`. Enabling the scheduler goes in launch prep.

## Admin actions on the website

The admin app has no Stripe key (CLAUDE.md), so refunds and cancellations call the website's `/api/admin/...` routes. The two apps run on different addresses, so this is a cross-site request, and it's designed deliberately (decision 14):

- **The token is sent explicitly.** The admin app sends `Authorization: Bearer <access token>`, the admin's own Supabase session token. No cookies cross between the apps (the website's cookies are its own, `SameSite=Lax`), so a page on another site can't make the admin's browser call these routes with the admin's rights.
- **The website checks the token itself:** it verifies it with Supabase (`auth.getUser(token)`, not just decoding it), then requires `app_metadata.role = "admin"` (`requireAdminToken`, a new helper next to `requireProvider`).
- **Only from the admin app's address.** The routes accept a request only when its `Origin` header is exactly the admin app's (`NUXT_ADMIN_ORIGIN`: `http://localhost:3101` in development). They answer the browser's CORS preflight for that origin only, with `Access-Control-Allow-Credentials` off. Any other origin, or no origin, is refused before the token is looked at.
- **What it isn't:** a replacement for the database's rules. The routes use the server key only after these checks, and every change is logged in `booking_events` with `admin` as the actor.

**Tests**, against the website's routes with the local stack:

| Request | Expected |
| --- | --- |
| No token | 401 |
| A valid token, not an admin | 403 |
| An admin token, `Origin` missing or another site's | 403 |
| An admin token with a forged or expired token | 401 |
| An admin token from the admin app's origin | 200, and the change is logged as `admin` |
| A preflight (`OPTIONS`) from another origin | No CORS allowance |

## Webhooks

The existing endpoint (`/api/stripe/webhook`) listens to **connected account** events (`account.updated`). Booking payments happen on **lokl's own** account, and Stripe sends those to a separately configured endpoint with its own signing secret. So: a second route, `/api/stripe/webhook-payments`, with `NUXT_STRIPE_PAYMENTS_WEBHOOK_SECRET`, verifying the signature on the raw body first, as the existing route does.

| Event | Action |
| --- | --- |
| `checkout.session.completed` | Services: mark `requested`, start the 48-hour window, notify and email the provider. Experiences: mark `confirmed`, email both |
| `checkout.session.expired` | Mark `expired`, release reserved spots |
| `payment_intent.canceled` | A hold that lapsed or was cancelled outside the app: mark `expired` if still `requested` |
| `charge.refunded` | Record the refund (also covers refunds made in the Stripe dashboard) |
| `charge.dispute.created` · `closed` | Flag the booking and hold its payout; show it on the admin's Disputes page |
| `transfer.reversed` | Record the reversal |

Webhooks can arrive late, twice or out of order, so each handler checks the booking's current status before changing it, and the routes also re-read the Checkout Session from Stripe rather than trusting the event body alone.

**Testing locally:** the Stripe CLI, logged in to the **Lokl sandbox** only (CLAUDE.md, Stripe-key boundary):

```bash
stripe listen --forward-to localhost:3100/api/stripe/webhook-payments
```

It prints a signing secret for local use, which goes in the website's `.env`. Test cards cover success, decline and authentication (3D Secure). `stripe trigger` sends sample events, and a booking walkthrough with test cards exercises the real flow. A second `stripe listen --forward-connect-to …` covers the existing connected-account route.

## Emails

Sent from the website's server through Resend's API (a new server-only key, `NUXT_RESEND_API_KEY`), from `lokl@innatetheory.com` until lokl has its own domain (answer 1). Plain language, short, and with a link to the booking page rather than private details in the email body. Addresses and notes are shown only signed in, since emails get forwarded.

| Email | To | When |
| --- | --- | --- |
| Request sent | Customer | Service checkout done: "We've asked <provider>. They have until <time> to accept. Your card is on hold, not charged." |
| New request | Provider | Same: "Accept or decline by <time>" with a link |
| Request accepted | Customer | Accepted: date, price charged, link to details and address |
| Request declined / expired | Customer | Hold released, nothing charged |
| Booking confirmed | Customer, provider | Experience paid |
| Booking cancelled | Customer, provider | Any cancellation, saying whether a refund applies |
| Payout sent | Provider | Transfer made |

Templates live in the website as small functions (subject, plain text, simple HTML), tested by sending to Resend's test addresses. Every send is logged against the booking. Reminder emails the day before are for later (`docs/TODO.md`).

## Pages

### Customer

- **Listing page:** "Booking opens soon" becomes the booking form.
  - **Services:** up to three preferred dates and times (in the market's time zone, each at least 24 hours ahead), notes, and the address for "I come to you".
  - **Experiences:** a session and the number of people (up to 10, and no more than the spots left), with "3 spots left".
  - **Before paying:** the price, and the cancellation policy in plain words: "Free cancellation until 48 hours before. After that, no refund. If the provider cancels, you always get a full refund."
  - Not signed in: "Sign in to book", which comes back to the same listing afterwards.
- **After Checkout:** a confirmation page for each kind. Services: "Request sent. You'll hear back by <time>. Your card is on hold, not charged." Experiences: "You're booked."
- **My bookings** (`/account/bookings`, any signed-in user): upcoming and past, each with its status in words, and a detail page.
  - **Details:** date and time, price, the exact address once confirmed, the notes, and "Cancel booking", with the refund outcome stated before confirming. After the booking time and before the payout: "The provider didn't show up", which holds the payout for the admin to refund (answer 7).

### Provider

- **Bookings** (`/dashboard/bookings`, replacing the placeholder):
  - **Requests:** each with the time left to answer, the customer's name and notes, and their preferred times, one of which the provider accepts, or Decline.
  - **Upcoming:** the customer's name, party size and notes, and, now that it's accepted or confirmed, their email, phone if given, and for an "I come to you" Service their address.
  - **Past.**
- **Sessions:** spots booked per session. A session with bookings can't be moved (decision 12), only cancelled, which warns that everyone is refunded.
- **Payouts:** booking payouts sent and due, alongside the existing setup status.
- **The bell:** new requests, bookings and cancellations, through the existing notifications.

## Admin

- **Bookings & payouts** (replacing the placeholder): every booking, with filters (status, kind, provider, date), the money split, and the payout state. Reported no-shows are listed first, with their payout held, for the admin to refund. Refund or cancel with a reason, through the website route. A "needs attention" list: transfers the provider's account couldn't receive (decision 15), reversals that couldn't be recovered, reported no-shows, and jobs that failed. When a listing comes down or a provider is suspended, the admin sees its confirmed bookings, which stay valid unless the admin cancels them with full refunds (decision 13).
- **Disputes & refunds** (replacing the placeholder): open disputes, with their bookings and evidence due dates, linked to Stripe's dashboard.
- **Settings:** commission rates per kind, with who changed them and when.
- **Listing detail:** the listing's bookings.

## Flags: where the decisions don't fit as written

1. **"Spots are checked at payment"** (decision 3) can't stop two people who pay at the same moment from both getting the last spot; the second would have to be refunded after paying. The design reserves spots when checkout starts (for Checkout's 30-minute window), so the last spot is held while someone pays. Same intent, different moment.
2. ~~**"A customer is a login with no provider record"**~~ Resolved (answer 2): anyone signed in can book, except their own listings.
3. ~~**Services have no way to agree a different time**~~ Resolved (answer 3): the customer offers up to three times and the provider accepts one.
4. **Holding funds** (decision 4) is a legal and accounting question as much as a technical one (licensing, how long funds may be held), and Stripe's own limits on holding funds for connected accounts need checking against its current docs and agreement. Both are already on the launch blockers list; sandbox testing can go ahead.
5. **"48 hours before"** (decision 5) needs one clock. The design measures from the booking's start time in the market's time zone. An unaccepted Service request can be cancelled at any time for free, since nothing has been charged.
6. **Refunds cost lokl Stripe's fee** (decisions 5 and 7). Stripe keeps its processing fee on refunds, so every refunded booking costs lokl that fee, on top of the commission it gives back.
7. **Refunds after a payout** (a dispute after the transfer) need the transfer reversed, which can fail if the provider's Stripe balance is empty. lokl then carries the loss until it's recovered. Paying out 24 hours after the booking keeps this rare.
8. ~~**Emails need a sending domain.**~~ Resolved (answer 1): `lokl@innatetheory.com`, already verified in Resend.
9. **Statement name:** with separate charges, customers see lokl on their card statement, not the provider. That's normally right for a marketplace, but the Lokl sandbox's statement descriptor should be set to something recognisable.
10. **Sales tax** isn't calculated (Stripe Tax was skipped, `docs/decisions.md`). It's on the accountant list as a blocker for live payments.

## Open questions

All answered 2026-09-30 (see "Answers to the open questions" above).

## Tests

- pgTAP for every new table and rule (read access per role; no user writes; capacity and spots; the address rule), each broken once.
- A spots test against the local stack: many simultaneous reservations for the last spot, and exactly one succeeds.
- Webhook handlers tested with Stripe CLI events in the sandbox, including duplicates and out-of-order delivery.
- Job routes tested with bookings in each state, run twice to prove they're idempotent, including a refused transfer that's held and flagged, and requests on a listing that came down.
- The admin route checks in "Admin actions on the website".
- A sandbox walkthrough: request, accept, decline and expire a Service; book, sell out and cancel an Experience; refunds before and after payout; a payout landing in a test provider's account.

## Build order

Reviewable parts, each committed on its own:

1. **Database:** commission rates, bookings, booking contacts, addresses and events, the new read rules, the booking functions (spots, reservation, request), the status rules and the capacity trigger (show before `db:push`).
2. Server routes for checkout (both kinds) and the payments webhook, with the local Stripe CLI setup.
3. Booking forms on the listing page, and the confirmation pages.
4. Provider accept and decline, and both bookings pages.
5. Jobs (expire, release, pay out) and their scheduler.
6. Cancellations and refunds, session cancellation.
7. Emails.
8. Admin: Bookings & payouts, Disputes, commission settings.

## Out of scope

Messaging; reviews; tipping; discounts and gift cards; changing a booking's time; partial refunds; multiple currencies; sales tax calculation (blocked on the accountant).
