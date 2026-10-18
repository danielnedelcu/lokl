# Admin roles and the second sign-in factor

Status: **approved design** (2026-10-18; decisions below, under "Decided").
Nothing is built; nothing in the code, the database or Supabase's settings
has changed. To be built
before anyone else is given admin access ([docs/TODO.md](../TODO.md),
Launch prep, "Staff access").

## What it is

Today there is one kind of admin: anyone whose sign-in token says
`app_metadata.role = "admin"`, granted by hand in the SQL Editor, signed in
with an emailed code alone. Every admin can do everything.

This design adds:

- **Two roles.** **Owner** (everything) and **support** (problem reports,
  review moderation, viewing bookings, retrying emails, small refunds).
  Support can *ask* for a suspension, a payout release or a large refund;
  the owner approves or declines.
- **Roles checked live, from a table,** not from the sign-in token, so a
  removal or a change takes effect on the next request, not when the token
  expires.
- **A second sign-in factor for every admin, the owner included:** an
  authenticator app, through Supabase's MFA. The database accepts admin
  access only from a session that has passed it.
- **A Team page** in the admin app, for the owner only, to invite, change
  roles, reset a second factor and remove people. Every change is recorded
  in `admin_actions`.
- **Alerts** to the owner for sensitive actions, **daily limits** for
  support, and a **record of who viewed customers' contact details**.
- **No more granting admin by hand in SQL**, except in the documented
  break-glass procedure.

## Principles

1. **The database decides.** Every permission is enforced in access rules
   and database functions. The admin app's menus and pages follow the
   database, never the other way round.
2. **Live, not cached.** A person's role is read from `admin_members` on
   every request. The sign-in token only says *who* is signed in and
   whether they passed the second factor.
3. **Second factor everywhere.** No admin rule or admin function accepts a
   session that hasn't passed it (Supabase's `aal2`).
4. **At least one owner, always.** The last active owner can't be removed,
   downgraded or have their second factor reset by anyone but themselves.
5. **Nobody changes their own role.** Team changes are the owner's alone,
   and even an owner can't downgrade themselves while they are the last
   owner.
6. **Separate logins stay separate.** An admin login never owns a business
   (`admin_owns_no_provider`), now read from `admin_members`.
7. **Everything sensitive is recorded,** in append-only logs that hold ids,
   never contact details.

## Roles and permissions

| Area | Owner | Support |
| --- | --- | --- |
| Dashboard, problem reports board | yes | yes |
| Problem reports: reply, move, note | yes | yes |
| Reviews: remove, restore, dismiss reports | yes | yes |
| Bookings and payouts: view | yes | yes |
| Customers' contact details on a booking | yes, recorded | yes, recorded, daily limit |
| Retry a failed or skipped email | yes | yes |
| Cancel and refund a booking, up to the refund limit | yes | yes, within daily limits |
| Cancel and refund above the refund limit | yes | **request** |
| Release a payout hold; resolve a problem report with payment | yes | **request** |
| Suspend or reinstate a provider | yes | **request** |
| Remove parts of a provider's profile | yes | **hide** at once (alert); the files are deleted only when the owner confirms |
| Listings: approve, reject | yes | yes |
| Listings: unpublish a live listing | yes | yes, with an alert to the owner |
| Listings: restore | yes | yes |
| Destination guides, homepage | yes | no |
| Categories, markets and areas | yes | no |
| Commission rates, settings (limits, alerts) | **owner only** | no |
| Team: invite, change roles, reset second factor, remove | **owner only** | no |
| Approve or decline requests | **owner only** | no (can withdraw their own) |
| Disputes page (read), logs (read) | yes | yes |

**Removing profile content, for support** (decided 2026-10-18): removing
a headline, bio, avatar or cover deletes the files, so support can't do it
outright. Support **hides** the part at once: it stops showing publicly,
the provider is told as now, and the files are kept. The owner is alerted
and either **confirms** (the files are deleted, as today's removal does)
or **restores** it. An unconfirmed hide expires after 7 days into the
owner's queue, never into deletion. This keeps harmful content off the
site straight away, which a request alone wouldn't, while deleting
nothing without the owner.

### Permissions in the database

One helper per question, each read live and only for a session that passed
the second factor:

- `public.admin_role()` returns `'owner'`, `'support'` or null: the caller's
  active row in `admin_members`, and null unless the token's `aal` is
  `aal2`. Security definer, stable, `set search_path = ''`.
- `public.is_admin()` is redefined as `admin_role() is not null`. Its 43
  existing access rules keep working unchanged, now live and second-factor
  only.
- `public.is_owner()` is `admin_role() = 'owner'`.
- `public.admin_can(p text)` answers named permissions (`refund_small`,
  `contact_view`, `moderate`, `support`, `content`, `reference`, `money`,
  `providers`, `team`, `settings`) from a fixed role-to-permission list in
  the function. A third role later is a change to that list, with tests.

All three are wrapped `(select …)` in access rules, as `policy_guard.test.sql`
requires, so they run once per query.

### Server-only functions

The money, provider and support functions are called by the website's
server with the service key. That means `auth.jwt()` is the server's, not
the admin's, so they take `p_admin_id` and check it themselves. Today that
check reads `auth.users.raw_app_meta_data`. It becomes:

- `public.admin_role_of(p_admin_id, p_session_id)`: the person's active
  role from `admin_members`, **and** that `p_session_id` is a live session
  of theirs in `auth.sessions` with `aal = 'aal2'`.
- The website takes `p_session_id` from the admin's verified token (its
  `session_id` claim). A removed admin is signed out everywhere, so their
  sessions are gone too.

## Inventory: every admin check today, and the permission each needs

### The helper and the server-side check

| Where | Today | Becomes |
| --- | --- | --- |
| `public.is_admin()` (`providers` migration) | JWT `app_metadata.role = 'admin'` | `admin_role() is not null` (live, `aal2`) |
| `p_admin_id` checks inside service-role functions | `auth.users.raw_app_meta_data->>'role' = 'admin'` | `admin_role_of(p_admin_id, p_session_id)` plus the permission below |
| `support_admin_report()` (support's shared guard) | the same `raw_app_meta_data` read | `admin_role_of(…)`, permission `support` |
| `providers_owner_not_admin()` trigger | `raw_app_meta_data` | "has an `admin_members` row that isn't removed" |
| `support_notify()` ("tell every admin") | `raw_app_meta_data` | every **active** member |
| `isAdmin()` in `@repo/types` (website `checkAdminRequest`, admin `requireAdmin`, admin middleware) | `app_metadata.role` from the token | removed; each server reads the role with `admin_role()` through the person's own client, and the middleware asks the same |
| `bookingEmails.ts` (skip a support email to a former admin) | `app_metadata.role` | an active `admin_members` row |

### Access rules that use `is_admin()`

All keep `is_admin()` (now live, second-factor only) unless a row says
otherwise.

| Area | Rules | Permission |
| --- | --- | --- |
| Providers, listings, photos, addresses, areas, sessions, hours, holds, open days, ratings | `*_read_admin` | any admin |
| Listing photos, provider photos (storage): delete | `listing_photos_delete_admin`, `*_objects_delete_admin` | `providers` |
| Categories, cities, service areas: insert, update | `*_insert_admin`, `*_update_admin` | owner (`reference`) |
| Commission rates: update | `commission_rates_update_admin` | owner (`settings`) |
| Bookings, events, finances, no-show notes | `bookings_read_admin`, `booking_finances_read_admin`, `booking_reports_read_admin` | any admin |
| **Customers' email, phone, address** | `booking_contacts_read_admin`, `booking_addresses_read_admin` | **removed**: read only through `admin_booking_contact()` (below), recorded |
| Reviews, replies, review reports | `*_read_admin` | any admin |
| Support reports, messages, notes, events | `support_*_read_admin` | any admin |
| Admin notifications | `admin_notifications_read_own`, `_update_own` | any admin, own only |
| Guides, guide photos, versions, AI drafts, homepage | `guides_admin`, `guide_photos_admin`, `homepage_features_write_admin`, … | owner (`content`) for writes; any admin reads |
| Email outboxes | `booking_emails_read_admin`, `provider_emails_read_admin`, `support_emails_read_admin` | any admin, **without `to_address`** (a column grant), which only `contact_view` reads, recorded |
| Logs | `admin_actions_read_admin`, `commission_rate_changes_read_admin`, `job_runs_read_admin` | any admin |

### Functions

| Function | Who calls it | Permission |
| --- | --- | --- |
| `admin_dashboard`, `admin_listings_page`, `admin_reviews_page`, `admin_support_board`, `admin_ai_draft_cost`, `review_state`, `session_spots_left` | admins, through the API | any admin |
| `admin_bookings_page` | admins | any admin; **stops returning `customer_email`** (search by email stays and matches; the address isn't sent) |
| `admin_providers_page` | admins, provider pickers | any admin; **`owner_email` only with `contact_view`, recorded** |
| `admin_set_homepage_features` | admins | owner (`content`), and logged (it isn't today) |
| `admin_cancel_booking` | website, service key | owner; support up to the refund limit and daily limits; above it, a request |
| `admin_release_payout`, `admin_resolve_problem_paid` | website | owner; support: a request |
| `admin_set_provider_status` (suspend, reinstate) | website | owner; support: a request |
| `admin_remove_provider_profile_content` | website | owner; support **hides** the part (kept, alert), and the owner confirms the deletion or restores it |
| `admin_moderate_review` | website | `moderate` |
| `admin_support_reply`, `_move`, `_note` | website | `support` |
| Retry an email (`adminBookings.ts`, logged from TypeScript) | website | `support`; moves into a database function that checks and logs |
| `publish_guide`, `unpublish_guide` | admin app server | owner (`content`), and logged in `admin_actions` (they aren't today) |
| Listing approve, reject, unpublish, restore (admin app server, service key) | admin app | any admin; unpublishing by support alerts the owner. Moved into a database function that checks and **logs** (not logged today) |
| Categories, markets and areas (direct writes under the rules) | admin app | owner, and logged by a trigger (not logged today) |

## New tables

- **`admin_members`**: `user_id` (primary key, → `auth.users`), `role`
  (`owner`, `support`), `status` (`invited`, `active`, `removed`),
  `invited_by`, `invited_at`, `joined_at`, `removed_by`, `removed_at`,
  `updated_at`. Never deleted: a removal is a status, so the history stays.
  No API role writes it directly; only the team functions below, as the
  owner. Admins read it (the Team page shows it to the owner only).
- **`admin_requests`**: `id`, `kind` (`refund`, `release_payout`,
  `resolve_problem_paid`, `suspend_provider`, `reinstate_provider`),
  `target_id`, `details` (the amount and option chosen, never contact
  details), `reason`, `requested_by`, `status` (`pending`, `approved`,
  `declined`, `withdrawn`, `expired`), `decided_by`, `decided_at`,
  `decision_note`. Approving runs the action as the owner, through the
  same function, so the money code has one path. Pending requests expire
  after 7 days.
- **`admin_settings`**: one row, the owner's to change: the refund limit
  ($150), support's daily limits, and which actions alert the owner.
  Changes logged.
- **`admin_contact_views`** (append-only, like the other logs):
  `admin_id`, `booking_id` or `provider_id`, `what` (`booking_contact`,
  `booking_address`, `owner_email`, `email_recipient`), `viewed_at`.

`admin_actions` gains targets `admin_member`, `admin_request` and
`settings`, and actions `invite_admin`, `change_admin_role`,
`remove_admin`, `reset_admin_mfa`, `join_admin`, `request_action`,
`approve_request`, `decline_request`, `withdraw_request`,
`change_admin_settings`, plus the unlogged actions found in the inventory
(`approve_listing`, `reject_listing`, `unpublish_listing`,
`restore_listing`, `publish_guide`, `unpublish_guide`,
`set_homepage_features`, `change_category`, `change_market`). A role
change records the old and new role in its message.

## Customers' contact details

- The admin row rules on `booking_contacts` and `booking_addresses` are
  removed. Admins read them through
  `admin_booking_contact(p_booking_id)`, which checks `contact_view`,
  checks the daily limit, records the view in `admin_contact_views`, and
  returns the email, phone and address.
- The booking page shows "Show contact details" instead of showing them
  at once, so a view is a choice, and recorded once per page.
- `admin_bookings_page` stops sending emails to the browser.
  `admin_providers_page` sends the owner's email only through the same
  recorded path.
- The owner sees the record on the Team page: who viewed what, when.

## Daily limits and alerts

Defaults (decided 2026-10-18), the owner's to change in Settings. The
refund limit is **$150**.

| For support, per person per day | Limit |
| --- | --- |
| Refunds made directly (each at most the refund limit) | 5, and $500 in all |
| Contact details viewed | 40 bookings |
| Requests | 20 |

A limit reached is refused in the database with a plain message ("You've
reached today's limit for refunds. Ask the owner."), and the owner is
alerted.

**Alerts to the owner**, in the admin bell (`admin_notifications`) and by
email:
- a request waiting for approval;
- **every** refund or cancellation by support, each its own email (a daily
  summary may come later);
- a live listing unpublished by support;
- profile content hidden by support, waiting for the owner;
- a daily limit reached;
- a team change (invite, role change, removal, second factor reset), even
  the owner's own, so a takeover of the owner's account is visible;
- an admin signing in from a new device (proposed: after this is built,
  from Supabase's sign-in records).

## The second factor

- **What:** an authenticator app (time-based codes, TOTP), through
  Supabase Auth's MFA. Text-message codes stay off. First, confirm in the
  hosted project's Authentication settings that authenticator MFA is
  available on lokl's plan (`config.toml`'s CLI template comment mentions
  the Pro plan; authenticator codes are understood to be included on all
  plans, text messages not).
- **Turning it on:** `[auth.mfa.totp]` `enroll_enabled` and
  `verify_enabled` in `supabase/config.toml` and on hosted.
- **Signing in:** the emailed code as now (a session at `aal1`), then the
  authenticator code (`aal2`). The admin app sends an `aal1` session to a
  "Second step" page, and a session with no factor yet to "Set up your
  authenticator". Nothing else in the app works at `aal1`.
- **In the database:** `admin_role()` returns null unless the token's
  `aal` claim is `aal2`; `admin_role_of()` checks the session's `aal` in
  `auth.sessions`. So a stolen inbox alone can't reach any admin data, even
  through the API directly.
- **Two factors each:** everyone enrols a second authenticator (another
  device, or a password manager) at setup. Supabase allows up to 10.

### Recovery

- **A support member loses their authenticator:** the owner resets their
  second factor on the Team page (a server route that deletes their
  factors with Supabase's admin API and ends their sessions; logged;
  alerts). Their next sign-in sets up a new one.
- **An owner loses one authenticator:** they sign in with their second one
  and replace the lost one themselves.
- **An owner loses both, and another owner exists:** the other owner
  resets them, as for support.
- **The only owner loses both:** the break-glass procedure.

### Break-glass (the only owner is locked out)

Documented in the operations notes, kept outside the repository too
(printed):

1. Sign in to the Supabase dashboard. That account has its own second
   factor and recovery codes, kept separately (below).
2. Authentication → Users → the owner's login → remove its MFA factors
   (or, in the SQL Editor, delete their rows from `auth.mfa_factors`).
3. Sign in to the admin app with the emailed code and set up two new
   authenticators.
4. Check the Team page's record for anything you didn't do while locked
   out.

If the owner's own login is lost entirely (the inbox gone), the SQL
Editor adds a new owner, with a ready-made block that refuses a login
owning a business and writes `admin_actions` (`break_glass_owner`). This
is the **only** time a role is granted in SQL; it replaces the hand-run
block in `CLAUDE.md`.

## Joining and leaving the team

**Joining:**
1. On the Team page, the owner enters an email and chooses a role. A
   server route (owner, `aal2`) refuses an email whose login owns a
   business, creates the login if needed (Supabase's invite), adds an
   `invited` row to `admin_members`, logs `invite_admin` and emails the
   invitation.
2. The person signs in to the admin app with the emailed code. An invited
   person with no second factor goes straight to "Set up your
   authenticator" (two, as above).
3. Once they've passed the second factor, `admin_join()` (their own
   session, `aal2`) turns `invited` into `active` and logs `join_admin`.
   Only then do the admin rules let them in.
4. An invitation not taken up in 7 days lapses; the owner can send it
   again.

**Changing a role:** owner only, never for themselves while they're the
last owner. Logged with the old and new role; takes effect on the next
request.

**Leaving:** on the Team page, the owner removes a member: status
`removed`, `removed_at`, `removed_by`, logged. The same database function
ends all their sessions at once (it deletes their rows in `auth.sessions`,
which revokes their refresh tokens). Because roles are read
live, their next request is refused even with a token that hasn't expired
yet. Their login stays (it may have bookings as a customer elsewhere), with
no admin access. Their past actions keep their name in the logs.

**The last owner:** a trigger on `admin_members` refuses any change that
would leave no active owner (removal, downgrade, or a second-factor reset
by someone else), whoever makes it, the server key included.

**Nobody changes their own role:** the team functions refuse
`p_user_id = auth.uid()` for role changes and removal. An owner who wants
to step down asks another owner.

## The Team page (admin app, owner only)

Under Platform, replacing the "Users" placeholder:
- **Members:** name or email, role, status, joined, second factor (set up,
  how many), last sign-in. Actions per row: change role, reset second
  factor, remove. Each asks for confirmation and a reason, and says what
  happens ("They're signed out now and lose access at once").
- **Invite:** email and role.
- **Pending requests** from support: approve or decline, with a note.
- **Contact details viewed:** who, what, when, filterable.
- **Settings:** the refund limit, daily limits, alerts.

Support members don't see the page, and the database refuses its
functions to them. The menu follows the role from `admin_role()`.

## Moving from today's admin to the new roles, with no lost access

1. **Confirm and turn on** authenticator MFA (hosted and `config.toml`),
   with nothing yet requiring it.
2. **Ship the admin app's "Set up your authenticator" and "Second step"
   pages**, optional at first: today's `is_admin()` still accepts `aal1`.
3. **You enrol two authenticators**, sign out and in, and pass the second
   step. Keep the Supabase dashboard's own recovery codes and the
   break-glass notes to hand.
4. **A migration** creates `admin_members` and seeds it from today's
   admins (`raw_app_meta_data->>'role' = 'admin'`) as **active owners**,
   with `joined_at` now. In the same migration, `is_admin()` and the
   server-side check switch to the table and `aal2`.
5. **Before `db:push`,** the admin app shows a check (`admin_role_preview()`):
   "After the switch you'll be: owner; second factor: passed". It must say
   so for your current session, or the push waits. A pgTAP test proves
   the seeded owner keeps access at `aal2` and loses it at `aal1`.
6. **After `db:push`**, your session (already `aal2`) keeps working.
   `app_metadata.role` stays on your login for one release, unused, then
   is removed, and the `CLAUDE.md` grant block is replaced by the Team
   page and the break-glass notes.

## What stays outside the admin app (operational rules)

- **Supabase dashboard, Vercel (or the chosen host), GitHub, the domain
  registrar, Resend:** the owner only, each with its own second factor and
  recovery codes stored apart from the authenticator. Never shared with
  support. Their access isn't part of these roles.
- **Stripe:** the owner only, with Stripe's own second factor. If support
  ever needs to look at Stripe, a Stripe team member with a read-only
  role, never an administrator, and never the API keys. Refunds and
  payouts go through lokl's admin app, where they're limited and recorded.
- **Secrets** (`.env`, API keys): never shared with support, never in the
  admin app.
- **The owner's email account** (where admin sign-in codes arrive) and the
  **Supabase account** each have their **own second factor and recovery
  codes**, stored apart from the authenticator used for lokl's admin app
  (not on the same phone, not in the same place), so losing one device
  never loses all of them. The break-glass procedure depends on the
  Supabase account; the admin sign-in depends on the email account.
- **Business email** (`help@hilokl.com`): support may be given access to
  the support mailbox; the owner's mailbox stays the owner's, since it
  receives sign-in codes.
- **When someone leaves:** remove them on the Team page, and remove them
  from the support mailbox and any Stripe team seat the same day.

## Tests (when built)

- pgTAP for every permission, allowed and refused: owner, support, a
  removed member, an invited member, an `aal1` session, a non-admin.
- The last-owner trigger, including the server key; nobody changes their
  own role.
- Requests: support can't perform, can request, the owner approves and the
  action runs once; daily limits; the refund limit.
- Contact views are recorded and limited; `admin_bookings_page` sends no
  emails; outboxes hide `to_address`.
- `function_privileges` and `policy_guard` updated with the new helpers.
- e2e: invite, join with a second factor, a support member's refused
  action and request, the owner's approval, removal ending access at once,
  and the migration's preview.

## Decided (2026-10-18)

1. Support approves and rejects listings, restores them, and unpublishes a
   live listing with an alert to the owner. Support hides profile content
   and the owner confirms its deletion (above). No guides or homepage for
   support.
2. Refund limit $150; support's daily limits: 5 refunds and $500, 40
   contact views, 20 requests.
3. Requests and invitations expire after 7 days.
4. An email to the owner for every refund by support, to start; a daily
   summary can come later.
5. No second owner for now: the break-glass procedure covers a locked-out
   owner.
6. Before building: confirm on the hosted project that authenticator-app
   MFA is available on lokl's plan.
