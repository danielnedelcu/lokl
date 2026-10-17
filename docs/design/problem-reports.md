# Problem reports: providers tell lokl, the admin tracks them

Status: **approved** (2026-10-17, with the decisions below). Phase 1 (data) built and pushed 2026-10-17 (migration `support_reports`); phase 2 next.

Providers report a problem to lokl from their dashboard and follow it to
the end; the admin works the reports on a board. Customers reporting
problems, photos, assigning and replying by email come later (see Later).

## Summary

- **Provider:** "Report a problem" (a category, what happened, and
  optionally one of their listings and one of their bookings); a list of
  their reports with statuses in words; each report's page with its
  details and the message thread, where they reply.
- **Admin:** a board of four columns (To do, In progress, Waiting on
  provider, Done), safety reports marked Urgent; each report's page with
  its details, links to the listing and booking, the thread, and private
  notes the provider never sees.
- **Safety:** the form says "If anyone is in danger, call 911 first", and
  a safety report emails every admin at once, marked urgent.
- **Permanent:** reports, messages, notes and status history are never
  edited or deleted (the append-only guards).
- **Told:** the provider by bell and email when lokl replies (the email
  never contains the message); the admin by email and a new admin bell
  when a report or reply arrives; the dashboard's "Needs attention" counts
  open reports.

## Words

| Here | On screen |
| --- | --- |
| report | "report" ("Report a problem", "Your reports") |
| status `todo` / `in_progress` / `waiting` / `done` | provider: Received / We're looking into it / Waiting for your reply / Resolved; admin: To do / In progress / Waiting on provider / Done |
| message | a message in the report's thread, from the provider or lokl |
| note | an admin's private note on a report |

The tables are named `support_reports` and so on, not `problem_reports`:
`review_reports` (reports of reviews) and `booking_reports` (no-show notes)
already exist, and "support" leaves room for customers later.

## The provider's side

**Where:** a "Help" item in the dashboard menu, with the number of reports
waiting for their reply beside it (in words for screen readers: "Help, 1
report waiting for your reply").

- `/dashboard/help`: "Your reports", newest activity first, and a
  "Report a problem" button. Each row: the category, the first line of
  what happened, what it relates to, when it last changed, and the status
  in words (a `StatusBadge`, never colour alone). Paged on the server, 20
  at a time. Empty: "You haven't reported any problems. If something's
  wrong, tell us and we'll help."
- `/dashboard/help/new`: the form (below).
- `/dashboard/help/[id]`: the details (category, what it relates to, with
  links to the listing and booking), the status in words with a sentence
  for each ("Waiting for your reply: lokl asked you a question below."),
  then the thread, oldest first, and a reply box. Messages are labelled
  "You" or "lokl", with the time in Atlanta time.

**The form** (vee-validate with a zod schema in `@repo/types`, as every
form):

- **What's it about?** A radio group, in words: Bookings; Payments and
  payouts; My listing; The website; Safety; Something else.
- **"If anyone is in danger, call 911 first. Then tell us here."** shown at
  the top of the form, always (not only once Safety is chosen), as an
  alert with an icon and words.
- **What happened?** A textarea, 20 to 5,000 characters, with a hint:
  "What happened, when, and what you'd like us to do."
- **Which listing?** (optional) Their own listings, by title
  (`SelectInput`, "None").
- **Which booking?** (optional) Their own bookings, searched on the server
  by customer name or date (`SearchSelect`), shown as "Sat, Oct 18, 10:00
  AM (Atlanta time), Jordan". Choosing a booking fills in its listing.
- **Send report.** Then the report's page, with a toast: "We've got your
  report. We'll reply here." For Safety: "We've got your report and we've
  told the team now."

**A suspended provider can still report** (a paused account is a likely
reason to need help).

**Replying:** the provider replies on the report's page.

- Replying to a report that's Waiting for their reply moves it back to
  "We're looking into it".
- Replying to a Resolved report **reopens it (To do) if it was resolved in
  the last 30 days**, so a problem that comes back isn't lost.
- **After 30 days** the reply box becomes "Start a new report about this":
  a new report, with the old one linked ("Follows on from your report of
  Oct 3"), its category and listing and booking filled in.

**"This is sorted":** the provider can close their own report (it moves to
Resolved, recorded as their action), and the admin can reopen it. **Not a
Safety report:** only an admin closes those; the button isn't there.

## The admin's side

**`/reports`: the board.** Four columns, each a labelled list:

| Column | Cards, in order |
| --- | --- |
| To do | urgent first, then oldest first |
| In progress | urgent first, then longest since the last message |
| Waiting on provider | longest waiting first |
| Done | most recently done first; the last 30 days, with "See all done" (paged) |

- **A card:** "Urgent" (a badge with an icon and the word) for Safety;
  the category; the provider's business; the first line; how long since
  the last message and who sent it ("Provider replied 2 hours ago").
- **Each column shows 50** with "Show more" and its total; the board is
  one database function (`admin_support_board`, a schema in `RPC_SHAPES`),
  so nothing stops at the API's 1,000 rows.
- **Filters:** category, urgent only, and a search of the business name
  and what happened, by the admin searches' words (`admin_search_patterns`:
  `%` and `_` match literally).
- **No column stops quietly:** each shows its first 50 and its total
  ("Showing 50 of 312"), with "Show more" loading its next page
  (`admin_support_board`'s `p_column` and `p_page`).

**Moving a card, without needing drag and drop:**

- Every card has a **"Move to…"** button opening a menu of the other
  three columns (keyboard and screen readers use only this).
- Drag and drop moves cards too, for a mouse (HTML's own drag and drop,
  no new library), and does exactly what the menu does.
- After a move, focus stays on the card in its new column, and a polite
  live region says "Moved 'Payout missing' to In progress." A move that
  fails puts the card back and says why ("That didn't save. The report is
  still in To do.").
- Each column is a `<section>` with its heading ("To do, 4 reports") and
  a `<ul>` of cards; each card's title is a link to its page.

**`/reports/[id]`: one report.** The details (category, urgent, the
provider with a link to their admin page, the listing and booking with
links to their admin pages), the status with the same "Move to…" control,
the thread, a reply box ("Reply to the provider"), and **private notes**
in their own section, clearly labelled "Only lokl sees these".

- **"Reply and wait for their answer"** sends the reply and moves the
  report to Waiting on provider in one step; plain "Reply" leaves the
  column as it is.
- The history of status changes (who, when) is listed at the bottom.

**The dashboard:** "Needs attention" gains "Open problem reports: 5 (1
urgent)", linking to the board; `admin_dashboard` returns `open_reports`
and `urgent_reports` (its schema in `RPC_SHAPES` gains them).

## Safety

- The 911 line is on the form always, and again on a Safety report's page.
- **A Safety report is urgent from the moment it's sent:** every admin gets
  an email at once ("Urgent: a safety report from Fresh Cuts Studio"),
  sent by the website right after the report is saved, the way booking
  emails are sent (`kick…Emails`), not waiting for the email job; and the
  admin bell shows it.
- It sits first in To do with "Urgent", and the dashboard counts it.
- lokl never gives safety, medical or legal advice in these screens; the
  wording points to 911 for danger.

## Data

### `support_reports`

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `provider_id` | the business reporting; references providers, restrict (never deleted) |
| `reporter_id` | the login that sent it; references auth.users, set null on delete |
| `category` | `booking`, `payments`, `listing`, `website`, `safety`, `other` |
| `urgent` | generated: `category = 'safety'` |
| `description` | 20 to 5,000 characters; never changes |
| `listing_id` | optional; references listings, restrict; must be the provider's own |
| `follows_report_id` | optional; the earlier report this one follows on from (a reply after 30 days); must be the same provider's |
| `booking_id` | optional; references bookings, restrict; must be a booking of the provider's listing |
| `status` | `todo`, `in_progress`, `waiting`, `done`; the server only |
| `status_changed_at`, `last_message_at`, `last_message_from` | kept by triggers, for the board's order |
| `resolved_at` | when it last moved to Done (the 30 days are counted from it); kept by the trigger |
| `created_at`, `updated_at` | |

**Never deleted, and only `status` and the trigger-kept columns change**
(a guard trigger refuses any other update, as `bookings_guard` does). The
listing and booking checks are in a trigger, so a provider can't attach
someone else's.

### `support_messages` (append-only)

`id`, `report_id`, `author_kind` (`provider` or `admin`), `author_id`
(set null if the login is deleted), `body` (1 to 5,000 characters),
`created_at`. The report's description is shown as the thread's first
item; it isn't copied into a message.

### `support_notes` (append-only, admin only)

`id`, `report_id`, `admin_id`, `body` (1 to 5,000), `created_at`.

### `support_report_events` (append-only)

Each status change: `report_id`, `from_status`, `to_status`, `actor`
(`provider`, `admin`, `system`), `actor_id`, `created_at`, written by a
trigger. The board's "how long in this column" and the report's history
come from here.

All three logs get `append_only_guard` (and the truncate guard), and join
the list in `append_only.test.sql`. Messages and notes are content people
wrote, so they may hold names or details; they're readable only as below,
never logged elsewhere, and never put in an email.

### Notifications

- **Provider bell:** `notifications` gains kind `support_reply` and a
  `support_report_id` column (cascade-free: reports aren't deleted), made
  by a trigger when an admin message is added. The sentence: "lokl replied
  to your report about payments." Realtime and "mark read" as today.
- **Provider email:** a new outbox, `support_emails` (like `booking_emails`:
  pending, sending, sent, skipped, failed; the delivery columns only
  change), kind `provider_support_reply`: "lokl replied to your report.
  Read and reply in your dashboard: <link>". **Never the message.**
- **Admin email:** kinds `admin_support_new`, `admin_support_safety` and
  `admin_support_reply`, to **every admin login** (looked up when sending,
  so a new admin is included with no setting to change). Category,
  business name and a link; never the description or message. Safety's
  subject starts "Urgent:".
- **Admin bell (new):** `admin_notifications` (`recipient_id` an admin
  login, `kind`, `report_id`, `created_at`, `read_at`), one row per admin
  per event, by trigger; a bell in the admin app's header like the
  provider's, refreshed live (Realtime) and when the tab regains focus.
  Admins read and mark read only their own rows.
- **Live replies, without broadcasting text** (decided 2026-10-17): message
  content never goes through Realtime. Only the notification rows do
  (`notifications` for the provider, `admin_notifications` for admins),
  and they hold ids, never text. When one arrives for the report that's
  open, the page reloads that report's thread at once, through the normal
  access rules; on the admin's side the board reloads too. So a reply
  appears on the other side without a manual reload, and a page left open
  in the background also reloads when its tab regains focus
  (`useLiveData`).
- **Sending at once:** reports and replies are written through website
  routes, which then send what they queued (as booking changes do); the
  email job retries anything that failed. (The job scheduler isn't
  running yet: until it is, only a failed first send waits.)

### Who can do what

| | Visitor | Customer | Provider | Admin | Server |
| --- | --- | --- | --- | --- | --- |
| `support_reports` | none | none | read own; create own (through the website route); close own ("This is sorted"), except Safety | read all | status (admin routes), trigger columns |
| `support_messages` | none | none | read own reports'; add to own report unless it was resolved over 30 days ago | read all | admin replies (website admin route) |
| `support_notes` | none | none | **none** | read and add | |
| `support_report_events` | none | none | read own reports' | read all | trigger only |
| `admin_notifications` | none | none | none | read own, mark own read | trigger only |

- Providers' rules use `(select public.current_provider_id())`, with
  `report_id in (select …)` for the child tables (helpers once per
  query, `policy_guard.test.sql`).
- Column grants: providers insert `category`, `description`, `listing_id`,
  `booking_id` (the rest from defaults and triggers) and messages' `body`,
  `report_id`; nothing else.
- **Rate limits** in the database: at most 10 reports and 50 messages a
  day per provider. **A Safety report is never refused by the limit** (nor
  a message on one). The page's message: "You've sent a lot of reports
  today. If anyone is in danger, call 911. You can also email us at
  <the support address>." (`runtimeConfig.public.supportEmail`, the address
  the dashboard's footer shows; the database's error says only that the
  limit is reached.)

### Routes

- Website, provider: `POST /api/provider/support-reports` (create, then
  send the emails), `POST /api/provider/support-reports/:id/messages`.
- Website, admin (`useWebsiteAdmin`, which can send email):
  `POST /api/admin/support-reports/:id/messages` (reply, optionally "and
  wait"), `POST /api/admin/support-reports/:id/status`,
  `POST /api/admin/support-reports/:id/notes`. Each checks the admin
  token and origin, and is logged in `admin_actions` with the report id.
- Reads go through the user-scoped client (RLS), through database
  functions where a list is paged (`my_support_reports`,
  `admin_support_board`, each with a schema in `RPC_SHAPES`).

## Accessibility

- **Board:** labelled column lists, "Move to…" on every card, moves
  announced, focus kept on the moved card, no drag-only actions, Urgent in
  words and an icon, 44px targets.
- **Provider:** a plain list, statuses in words with a sentence each, the
  911 line as text in an alert, every field labelled with errors tied to
  it, "Sent" announced after a reply.
- **Threads:** a list of messages, each with its author and time as text.
- Checked with axe; keyboard-only e2e journeys for both sides.

## Writing

Plain and kind: "Report a problem", "What happened?", "We've got your
report", "Waiting for your reply: lokl asked you a question below." No
"ticket", "case" or "SLA". No promise of a response time on screen until
there's an agreed one.

## Tests

- **pgTAP:** each access rule allowed and refused (another provider's
  report, a customer, a visitor, a provider reading notes, writing status
  or another's listing or booking); the append-only guards on messages,
  notes and events; the guard on reports' columns; the status triggers
  (a provider reply on Waiting goes to In progress, on Done reopens to To
  do); the notification and email rows per admin; the rate limits; the
  new functions in `function_privileges`; `RPC_SHAPES` for the new JSON
  functions.
- **App tests:** the routes (create, reply both ways, status, notes),
  emails queued and sent with no message text (the test reads the
  rendered email), a Safety report emailing every admin at once, the
  admin bell rows.
- **E2e:** a provider reports a Safety problem by keyboard (the 911 line
  visible), replies, and sees the statuses in words; the admin moves a
  card with "Move to…" only (announced, focus kept) and by dragging, replies
  "and wait", adds a private note the provider's page never shows; the
  provider's bell and the admin's bell; the dashboard count; **with the
  report open on both sides, a reply from either appears on the other's
  page without a manual reload** (and on the admin's board), and no
  Realtime message carries the reply's text (the e2e reads the socket's
  frames for it).
- **Deliberate breaks,** each caught: a provider reading another's
  report; a note readable by a provider; a message edited; the email
  containing the message; a move not announced.

## Build order

1. **Data:** the tables, guards, rules, triggers, rate limits, functions
   and pgTAP; shown before `db:push`.
2. **Provider side:** Help list, form, report page, replies, the bell kind,
   the reply email.
3. **Admin side:** the board, the report page, notes, status moves, the
   admin bell, the admin emails (Safety at once), the dashboard count.

## Later

- **Photos** on reports and messages (Storage, a private bucket, the same
  rules).
- **Customers reporting problems** (a `reporter_kind` on the same tables,
  their own pages under `/account`).
- **Assigning** a report to an admin, and filtering the board by it.
- **Replying by email** (an inbound address per report).

## Decisions (2026-10-17)

1. **Reopening:** a provider's reply reopens a report resolved in the last
   30 days; after that, "Start a new report about this" creates a new
   report linked to the old one.
2. **"This is sorted":** providers can close their own report (recorded as
   theirs; the admin can reopen it), except Safety reports, which only an
   admin closes.
3. **Admin emails** go to every admin login.
4. **Rate limits:** 10 reports and 50 messages a day per provider; Safety
   reports are never blocked; the limit message gives the 911 line and the
   support email address.
