# Provider notifications

Status: approved design · 2026-09-27. Build after step 6 is committed.
Follows build step 6 (admin review). Covers in-app notifications, live updates and refresh rules, and how email reuses the same records later. Email itself is out of scope.

## Why

Admin actions change a provider's listing without the provider doing anything: an Experience is approved or sent back, a listing is taken down or restored. Today providers only find out by opening the dashboard (the "N listings need your attention" notice), and an open page keeps showing the old status until it's reloaded.

## Decisions

Add these to `docs/decisions.md` once approved.

| Decision | Why |
| --- | --- |
| Notifications are created by a database trigger on listing status changes, never by the app | Every way an admin changes a status (routes today, anything later) creates one, and no one can fake or suppress one from a browser |
| Only admin transitions notify: approved, sent back, taken down, restored | Providers don't need to be told about their own actions |
| A notification belongs to the provider (the business), not a login | Matches listings; when team members arrive, each member reads the business's notifications |
| Providers read their own and mark them read; nothing else | The table is a record of what happened; the only thing a provider changes is whether they've seen it |
| Live updates use Supabase Realtime (Postgres Changes) on `notifications` only | One subscription per provider, filtered by the same RLS policy that guards reads; listings don't need their own Realtime |
| A notification arriving refreshes any open page that shows its listing | The status on screen stays right without a reload |
| Pages that show data someone else can change refresh when the tab regains focus, and never overwrite unsaved changes | Covers changes that don't create a notification, and tabs left open for hours |
| Email later reads the same rows; it doesn't get its own event source | One record of what happened, one place to decide who's told |

## Table

### notifications

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `provider_id` | references providers, restrict (providers are never deleted). The recipient |
| `kind` | `listing_approved`, `listing_rejected`, `listing_unpublished`, `listing_restored` |
| `listing_id` | references listings, **on delete cascade**: deleting a listing deletes its notifications. A listing can only be deleted while it has never been live, which among these kinds only a sent-back Experience can be |
| `created_at` | |
| `read_at` | null while unread. Set when the provider opens the list or marks all as read |

Index on `(provider_id, created_at desc)`, and a partial index on `(provider_id) where read_at is null` for the unread count.

The sentence isn't stored. It's written at display time from `kind` and the listing's current title, so the wording can change in one place (a shared `notificationText()` in `packages/types`) and a renamed listing reads correctly. The reason isn't copied either; the notification links to the listing, where the editor shows the current reason.

Delete: not from the app. When a listing is deleted, its notifications are deleted with it (cascade), so the bell never links to a listing that's gone; the pgTAP tests check this. Everything else is kept for now; a later cleanup job deletes read notifications older than six months (`docs/TODO.md`).

### Trigger

`listings_notify_status_change`, `after update of status on listings`, `security definer` (it inserts rows the updating user can't). It inserts one row when the change is one of:

| From → to | Kind | Sentence (example) |
| --- | --- | --- |
| submitted → live | `listing_approved` | "Taco crawl" was approved and is live. |
| submitted → rejected | `listing_rejected` | lokl sent back "Taco crawl". See what to change. |
| live → unpublished | `listing_unpublished` | lokl took down "Taco crawl". See why. |
| unpublished → live | `listing_restored` | "Taco crawl" is live again. |

Those four transitions are admin-only (the provider routes can't make them), so the trigger doesn't need to know who acted. Provider transitions (publish, submit, unlist) create nothing. A status "change" to the same value creates nothing.

### Access rules

| | Signed-out | Provider | Admin | Server |
| --- | --- | --- | --- | --- |
| notifications | None | Read own; mark own read | None | Trigger inserts |

- `notifications_read_own`: `provider_id = current_provider_id()`.
- `notifications_update_own`: same `using`, and `with check (read_at is not null)`, so a notification can be marked read but not unread.
- Column grants: `update (read_at)` only. No insert or delete grant to `anon` or `authenticated`; no insert or delete policy.
- The admin gets no policy: nothing in the admin app needs these, and the design keeps them the provider's. (An audit log for admin actions is a separate TODO.)

## Realtime

- Add the table to the `supabase_realtime` publication in the migration.
- The provider dashboard layout opens one channel after sign-in: Postgres Changes, `INSERT` on `notifications`, with `filter: provider_id=eq.<their id>`. The filter keeps traffic small; **RLS is what keeps it private**: Realtime checks each change against the subscriber's `notifications_read_own` policy before sending it.
- The channel closes on sign-out and reconnects on its own. After a reconnect the bell refetches, since changes during the gap aren't replayed.
- **Ready means watching the database.** A channel is "joined" before Realtime is watching the table; a change in between is lost (the first Realtime test run caught this). The bell's first fetch waits for Realtime's "Subscribed to PostgreSQL" message, and refetches after every rejoin.

### Tabs left open for hours

Sign-in sessions last an hour (`jwt_expiry` 3600) and supabase-js refreshes them in the background. Realtime checks each change against the token the channel was given, so an expired token would silently stop delivery. To keep a long-open tab live:

- **The first join:** before every join, the feed loads the signed-in token into Realtime (`realtime.setAuth()` with no argument). On a fresh page load the browser client reads its session from cookies a moment after it's created, and a join sent before that goes out signed out and is refused. [Found in the walkthrough, 2026-09-28: the bell received nothing live. Reproduced on the local stack with the website's browser client; `notifications-page-load.realtime.test.mts` covers it.]
- **Refreshed tokens after that:** supabase-js (2.117 here) passes each refreshed token to Realtime itself, and Realtime asks for the current token on every heartbeat, which also renews an expiring session. The token-refresh test proves it.
- **Console:** the bell logs `[notifications] live updates on` when it's ready, each notification received, and any reconnect or problem.
- Watch the channel's status. On `CHANNEL_ERROR`, `TIMED_OUT` or `CLOSED` (while still signed in), resubscribe with a short backoff, then refetch the bell and let open pages refresh, since nothing is replayed.
- When the tab becomes visible again, check the channel is joined and resubscribe if not. Browsers slow timers in hidden tabs, so the heartbeat and token refresh can both lapse while a tab is in the background.

Tested two ways:

- **Automated, local:** the Realtime test runs against a local stack with `jwt_expiry` lowered to 120 seconds in `supabase/config.toml`. (This affects local development only: local sessions then refresh every two minutes, which exercises the same path during everyday work. Hosted settings are unchanged.) The provider subscribes with the bell's own channel code (`createNotificationFeed()`), and after every token refresh, and again after the first tokens have expired, a listing change must still arrive. Broken once by turning token refresh off (`NO_REFRESH=1`): once the session expires, the change must stop arriving. The test refuses to run unless the local session is short; the `jwt_expiry` change is made for the run and reverted, never committed.
- **Manual, hosted:** leave a provider tab open, in the background, for over an hour (75 minutes), then take one of their listings down in admin. The bell and the open page must update within a few seconds of switching back to the tab, or live if the tab stayed visible.
- `DELETE` events aren't subscribed to (they skip RLS and carry only the id); deletes only happen by cascade anyway.

### Test that providers never receive each other's

pgTAP covers the table rules. Realtime delivery is a separate path, so it gets its own test: `supabase/tests/realtime/notifications.realtime.test.mjs`, run by `npm run db:test:realtime` against the **local** stack only.

1. With the local service key, create two test providers (A and B) with their own logins, and sign both in, each on its own client.
2. Each subscribes to `notifications` INSERT events, B with the filter set to **A's** provider id (the attack: asking for someone else's).
3. With the service key, change one of A's listings from live to unpublished.
4. A receives exactly one event, for that listing. B receives nothing within 5 seconds, even with A's filter.
5. Clean up the test users and rows.

Also break it once: temporarily widen `notifications_read_own` to `using (true)` and confirm B then receives A's event, so the test is shown to catch a leak.

## Provider dashboard: the bell

A shared `NotificationBell` component in `packages/ui` (the admin app may reuse the pattern), placed in a new top bar on the dashboard layout. The dashboard has no top bar yet; this adds one on the right, which is also where the missing mobile menu button will go.

- **Button:** a bell icon, 44px touch target. With anything unread, a dot with the count, capped at "9+" (1 to 9, then 9+). The button's accessible name follows the same cap: "Notifications, 2 unread", "Notifications, more than 9 unread", or "Notifications" when all are read. The dot is decorative (`aria-hidden`), since the name carries the number.
- **Dropdown:** the 20 most recent, newest first. Each item: the sentence, "2 hours ago" (the shared `formatAge()`), and the whole item links to the listing's editor. Unread items are marked with a small "New" label, not colour alone.
- **Mark all as read:** a button at the top of the list, shown when anything is unread. Opening a notification marks that one read.
- **Empty state:** "No notifications yet. We'll let you know here when lokl reviews or changes one of your listings."
- **Live:** a new notification adds itself to the top and bumps the count. A polite live region announces it once: "New notification: lokl sent back "Taco crawl"."
- **Errors:** if the list can't load, the dropdown says so in a sentence and logs the detail.

The overview's "N listings need your attention" notice stays: it shows current state (what's still rejected or taken down), while notifications show what happened.

## Keeping pages current

One shared composable in the layer, `useLiveData()`, used by every page that shows data someone else can change:

```ts
useLiveData({
  refresh,                          // the page's useAsyncData refresh
  listings: () => [listingId],      // optional: refresh when a notification names one of these,
                                    // or "any" for lists of the provider's listings
});
```

- **Tab focus:** when the tab becomes visible again (`visibilitychange`), refresh, at most once every 15 seconds.
- **Notifications:** the bell broadcasts each arriving notification's listing id inside the app; pages listening for that id refresh straight away. "My services", "My experiences", the dashboard overview and the listing editor all use it.
- **Unsaved changes:** `useLiveData()` only refreshes data. A page with a form protects unsaved changes itself: it refreshes the saved record and never resets a dirty form. See the editor rules below.

### The editor

The editor already keeps the saved listing (`saved`) apart from the form. A refresh updates `saved`; the form is only reset when it has no unsaved changes.

| Refresh finds | Form has no unsaved changes | Form has unsaved changes |
| --- | --- | --- |
| Same status, same fields | Nothing visible changes | Nothing visible changes |
| Same status, fields changed (e.g. edited in another tab) | Form shows the new values | Form keeps the provider's values; a notice says "This listing was changed somewhere else. Saving will replace those changes." |
| Status changed to one that still allows edits (e.g. submitted → rejected) | Form resets; the status note and reason update | Form keeps the provider's values; status, checklist and reason update around it |
| Status changed to a locked one (e.g. live → unpublished) | Form resets and locks | Form keeps the provider's values, read-only, with "lokl took this listing down while you were editing, so these changes can't be saved. Copy anything you want to keep." |

The leave-page warning stays as it is.

## Email later

Email reads the same `notifications` rows; nothing else creates events.

- Add `emailed_at` and `email_error` columns, and a `notification_preferences` table (provider, kind, email on or off; on by default for these four kinds).
- A database webhook on `notifications` INSERT calls a Supabase Edge Function that sends through Resend (already the auth email sender), using the notification id as the idempotency key so a retry can't send twice, then sets `emailed_at`.
- The email says the same sentence and links to the listing. It doesn't include the rejection or takedown reason; the provider reads that signed in.
- Needs the email sender from launch prep, and an unsubscribe link.

## Tests

pgTAP, `supabase/tests/notifications_access.test.sql`, every rule broken once:

- Each admin transition creates exactly one notification of the right kind for the listing's provider.
- Publish, submit and unlist create none; an update that doesn't change status creates none.
- A provider reads their own, not another provider's; signed-out visitors and the admin read none.
- A provider can mark their own read, can't mark another's, can't mark one unread, and can't change any other column.
- Nobody inserts or deletes from the app (provider, admin, signed-out).
- Deleting a never-published listing removes its notifications.

Plus the Realtime tests above: providers never receive each other's, and delivery survives token refreshes.

## Build order

1. Migration and pgTAP tests (show before `db:push`).
2. Realtime tests (isolation, and token refresh with the local `jwt_expiry` change).
3. `notificationText()`, `NotificationBell`, the dashboard top bar.
4. `useLiveData()`, wired into the overview, both listing lists and the editor, with the editor rules.
5. `docs/frontend.md` pattern (below), TODO and decisions.

## Out of scope

Email (above); notifications for customers or the admin; notification settings; push notifications.

## Settled questions

Decided 2026-09-27.

- **Retention:** keep everything for now. Later, a cleanup job deletes read notifications older than six months (`docs/TODO.md`).
- **Read state:** per business for now. Revisit when businesses get team members; per person would need a separate read table.
- **Admin side:** admin pages refresh on focus with the same composable, but get no live updates until there's an admin bell ("Admin notifications, such as new Experiences waiting for review" in `docs/TODO.md`).
