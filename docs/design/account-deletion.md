# Account deletion

Status: designed 2026-10-21, **not built**. Building waits until the lawyer
and accountant have settled the Privacy Policy's retention and deletion
sections (`docs/legal/questions-for-review.md`). Decisions are in `docs/decisions.md`.

## Where things stand

- A login can't be deleted once it has records. Six foreign keys to
  `auth.users` refuse it (`on delete restrict`): `providers.owner_id`,
  `bookings.customer_id`, `reviews.customer_id`, `admin_members.user_id`,
  `admin_requests.requested_by` / `decided_by`, `admin_contact_views.admin_id`.
- There's no deletion function, route or page. The Terms for hosts promise
  "You can close your account by emailing" support, and the Privacy Policy
  promises to act on deletion requests by email.
- The append-only logs can only be changed by a migration
  (`append_only_logs`), one per request, which doesn't scale to a button.

## The principle

Erase the person, keep the business record.

- **Kept, de-identified:** a booking's money and history, for tax and
  disputes, with ids and amounts only and no link to the login.
- **Deleted:** whatever identifies or describes the person: the login,
  contact details, addresses, free text they wrote, photos, the public
  profile.
- **Later:** when a retention period ends (once the lawyer and accountant
  set them), a purge job deletes what's left. That's a separate step.

## A customer deletes their account

**First:** no upcoming booking. A confirmed booking, a pending request or
an open checkout is cancelled by the customer under the usual policy, or
reaches its end. The page lists exactly what's still open, with links.

| Data | What happens |
| --- | --- |
| Login: email, Google identity, sessions, authenticators | Deleted (Supabase removes identities, sessions and factors with the user) |
| Saved listings and providers | Deleted (already cascade) |
| Past bookings | **Kept** for the retention period: login link cleared, name becomes "Former customer"; notes, city, zip code and cancel reason cleared |
| The booking's contact email and phone, the Service address | Deleted |
| Their no-show report text | "[removed]"; the report stays (it decided a payout) |
| Reviews they wrote | **Deleted**, with the provider's replies; the provider's rating recalculates |
| Their reports about reviews | Deleted (already cascade) |
| Emails sent to them (outbox rows) | Kept as the record of what was sent; the address cleared |
| Stripe | lokl makes no Stripe customer. Payments (with the email given at checkout) stay with Stripe, which must keep them; lokl's metadata on them holds only booking ids |
| Resend | Keeps its sending logs for its plan's window; nothing for lokl to delete |
| Google Analytics | Nothing: no user id is ever sent |
| Supabase's sign-in log (`auth.audit_log_entries`, which holds email addresses) | The person's rows removed by the erasure |

## A provider closes their business and deletes their account

**First:** no upcoming bookings (the provider cancels them, and customers
are refunded, as with any provider cancellation), no open requests, no
payout still due or held, and no open problem report or dispute. The page
lists each, with links.

| Data | What happens |
| --- | --- |
| Public profile (headline, bio, photo, cover) and listing photos | Deleted, files included; hidden profile content (`provider-photos-held`) too |
| Business record (`providers`) | **Kept** (bookings and payouts point to it): closed, name "Former provider", its address no longer works, login link cleared |
| Listings | Kept as closed, for their bookings; titles kept; descriptions, addresses and photos deleted |
| Hours, time off, open days, slots | Deleted |
| Replies to reviews | Deleted. The reviews about them stop showing (the profile is gone) and are kept for the retention period |
| Problem reports and messages | The provider's own words "[removed]"; dates and outcomes kept |
| Emails sent to them | Kept; addresses cleared |
| Stripe Express account | Deleted by lokl once its balance is zero; until then flagged, and a job retries. Stripe keeps the identity and bank records it must |
| Their login | Deleted. If they're also a customer with records, the customer steps run too (one login) |

"Former provider" rather than the business name, because a sole trader's
business name is often their own name.

## lokl removes a provider for breaking the rules

- **Who:** the owner, with a reason, from the provider's admin page.
  Support asks through Requests, as for suspension.
- **Upcoming bookings:** lokl cancels them with full refunds to the
  customers, through the existing cancellation path; customers are emailed.
- **Unpaid payouts:** for bookings that already took place, the owner
  decides each: pay for the work done, or hold and refund. The default is
  to pay unless something is held.
- **Erased at once:** the public profile, listings and photos, as above.
  The provider is emailed that the account is closed and which rule was
  broken.
- **The login stays**, tied to the closed business record, so the same
  login can't open a new business.
- **If they later delete the login:** lokl keeps a **keyed hash** of the
  email (HMAC-SHA-256 with a secret only lokl holds, in Vault, never in
  the repo), so a removed provider can't sign up again with the same
  address. Not a plain hash: anyone could match one by hashing guessed
  addresses. It's still personal data, so the Privacy Policy must say it's
  kept, why and for how long. **Marked for the lawyer.** The secret is
  never rotated: the stored hashes can't be recomputed without the
  addresses, so a new secret would make them useless.

## How a person asks and confirms

- **On the website.** Customers: "Delete my account" on their account
  page. Providers: "Close my business and delete my account" on Business
  profile. The page shows what will be deleted, what's kept and why, and
  anything still in the way.
- **Confirming:** a fresh code emailed to the account's address, as at
  sign-in.
- **Seven days' grace, account frozen at once.** A provider's profile and
  listings are hidden; nobody can book with them; the person can't book.
  Signing in during the week offers "Keep my account". Emails go out when
  they ask and when it's done.
- **By email**, as the Terms promise: support starts it from the admin
  app, which sends the same code to the account's address, so only the
  account holder can confirm.

## The append-only logs

One narrow, permanent exception instead of a migration per request:

- A new append-only `account_erasures` table records each erasure (ids
  only). Dedicated functions per kind (customer, provider, removed
  provider) do the work.
- While a recorded erasure runs, inside those functions, the guards accept
  exactly two kinds of change: a listed column set to null, or to the
  fixed text "[removed]". Nothing else changes and nothing is deleted;
  outside those functions, nothing changes.
- The links that refuse deletion (`bookings.customer_id`,
  `reviews.customer_id`, `providers.owner_id`, the booking contact email)
  become clearable, only through that exception.
- `assert_log_guards_on()` is extended to every custom guard (today it
  misses bookings, reviews, problem reports, requests, holds and the admin
  team).
- pgTAP proves: the exception can't be used from the API or outside a
  recorded erasure; it changes only the listed columns, only to null or
  "[removed]"; every other guard still refuses.

## Building it (three PRs, after the policy is settled)

1. **Database:** `account_erasures`, the erasure functions, the guard
   exception and the wider guard check, the link changes, the keyed-hash
   table and check, pgTAP for each allowed and refused case.
2. **Server and pages:** the website pages and code confirmation, the
   grace period (a daily job finishes due erasures), the admin "Remove
   provider" action and support's request, deleting the Stripe account and
   storage files, the emails, a browser journey per path.
3. **Retention purge jobs**, once the periods are confirmed.
