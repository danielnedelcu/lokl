# Service availability and slots

Status: approved 2026-10-14 (answers below) · phase 1 in progress

Services are booked today by request: the customer suggests up to three
times, the card is held, and the provider accepts one within 48 hours
(`docs/design/booking-and-checkout.md`; `docs/decisions.md`, 2026-09-27:
"providers don't keep a calendar… time slots can be added later"). This
proposal lets providers publish their availability and customers book a
real slot, like Airbnb's Services scheduling panel.

The old way has three problems:
- customers can't see when a provider is free;
- overlapping bookings only warn (`requestOverlaps`), never block;
- search can't filter Services by date (decided 2026-10-12: dates apply to
  Experiences only).

## Summary

- **Providers set availability once, for all their listings:**
  - weekly hours;
  - date-specific hours and days off;
  - time off;
  - a booking window, a minimum notice, a slot interval and a default
    buffer.
- **Slots are worked out on request.** A database function builds them from
  that availability, each Service's duration and buffer, and everything the
  provider already has booked, in the market's time zone.
- **Each Service has a booking mode, chosen by the provider when creating it**
  (no default):
  - **Instant:** the customer picks a slot and pays; it's confirmed.
  - **Approve each booking:** the customer picks a slot, the card is held,
    and the provider accepts or declines.

  Both replace free-form suggested times.
- **The database prevents double booking.** Every booking and Experience
  session holds a time range for its provider, and an exclusion constraint
  refuses any overlap across all the provider's listings, buffers included.
- **Search** filters Services by real availability when dates are given.
- **Later:** Google Calendar sync.

## Terms

| Term | Meaning |
| --- | --- |
| Market time | The market's zone (`cities.timezone`, `marketZone()`), labelled "Atlanta time". All availability is entered and shown in it, never the device's. |
| Weekly hours | Repeating intervals per weekday, such as Mon 9:00–12:00 and 13:00–17:00. |
| Date override | One date with its own hours, or closed. |
| Time off | A range of dates, closed. |
| Hold | A provider's busy time range (a booking or an Experience session, plus buffers). The database refuses overlapping holds. |
| Slot | A start time a Service can be booked at. |

## Provider availability

**One schedule per provider**, not per listing. A provider can't be in two
places at once, so all their Services and Experiences share it.

### Data

**`provider_schedules`** (one row per provider):

| Column | Meaning |
| --- | --- |
| `booking_window_days` | How far ahead customers can book: 7–180, default 60 |
| `min_notice_minutes` | 60 to 10,080 (one hour to one week), default 1,440 (24 hours, today's rule) |
| `slot_interval_minutes` | 15, 30 or 60, default 30, as in the screenshot |
| `default_buffer_minutes` | 0–120, default 0; for travel between appointments |
| `updated_at` | When it last changed |

**`provider_weekly_hours`:**
- Columns: `provider_id`, `weekday` (0 is Sunday), `starts`, `ends` (wall-clock times, `time`).
- A day can have several intervals. `ends` is after `starts`. Intervals on
  one day may not overlap (checked by a trigger).
- No hours means the provider isn't bookable.

**`provider_date_hours`:**
- Columns: `provider_id`, `on_date` (`date`), `starts`, `ends`: custom
  hours for one date. A date with any rows here ignores its weekly hours.
- A day off is time off for that one date (below), so there's one way to
  close a day.

**`provider_time_off`:**
- Columns: `provider_id`, `starts_on`, `ends_on` (dates, inclusive), and an optional `note` the provider alone sees.
- It closes whole days. Part of a day off is a date override.

**On `listings` (Services):**
- `booking_mode`: `instant` or `approve`, with no default: the provider
  chooses it when creating a Service. Null on Experiences. A Service
  without one isn't bookable. The editor requires it from phase 2, which is
  when the constraint "a Service has a mode" is added (with the editor and
  every test fixture that makes a Service).
- `buffer_minutes`: null means the provider's default.
- `duration_minutes`: becomes required for a bookable Service, 15 to 720
  (12 hours).

**Access:** a provider reads and writes their own schedule rows.
- Admins read them all.
- Visitors read none of them directly, only slots from the slots function.
- Delete behaviour: rows are the provider's own and deleted freely; nothing
  points at them.

**Wall-clock times:** stored as `time` and `date`, and turned into
instants in the market's zone when slots are built. This way 9:00 stays
9:00 across the clock changes, as with Experience sessions
(`weeklyInstants`).

### Rules

- **Hours inside the clock change:** on the March change day, 2:00–3:00
  doesn't exist. Intervals are cut to the real hours of that day. On the
  November change day, 1:00–2:00 happens twice, and slots in it are offered
  once (the first).
- **Notice and window** count from now in market time:
  - The earliest slot is `now + min_notice`.
  - The latest slot starts on the day `today + booking_window_days`.
- **Changing availability never touches existing bookings.** If a change
  removes hours that hold a booking, the editor lists those bookings; they
  stay as they are.

## Slots

`public.service_slots(p_listing_id uuid, p_from date, p_to date)` returns
`(starts_at timestamptz, ends_at timestamptz)`.
- It's a security definer function, callable by visitors, signed-in users
  and the service role.
- Dates are market days, at most 31 per call.

For each market day in range:
1. **Open intervals:** take the day's open intervals (its date hours, or
   else its weekly hours), unless the day is in time off.
2. **Candidate starts:** every `slot_interval` from each interval's start,
   while `start + duration` fits inside the interval. The buffer may run
   past the provider's hours: it's travel, not work.
3. **Keep a start only if:**
   - it's at least `min_notice` away, and inside the booking window;
   - its range `[start, start + duration + buffer)` overlaps no active
     hold of the provider.

**Buffers come after a booking only** (decided 2026-10-14). Each hold
covers `[start, end + buffer)`, so two back-to-back bookings are exactly
one buffer apart, never two.

**Visibility:** only for a live listing whose provider is active and can be
paid. Otherwise there are no slots, the same rule as browse's.

**Fixed answers:** the function returns starts only, never why a time is
missing. Customers see open times; nobody learns the provider's other
bookings.

**Performance:** at most 31 days × (24 h ÷ 15 min) = 2,976 candidates for
one listing, so a single call is cheap. Search needs more (see Search).

## No double booking

**`provider_holds`:** `provider_id`, `during tstzrange`, and `booking_id` or
`session_id` (exactly one).

```sql
exclude using gist (provider_id with =, during with &&)
```

**Snapshots:** a hold keeps the duration and buffer its booking or session
was made with. Changing a listing's duration or the provider's buffer later
never moves existing holds.

**Needs `btree_gist`.** Per CLAUDE.md ("Extensions too"), the migration:
- grants `EXECUTE` on the extension's functions only to the roles that
  write holds;
- has pgTAP check each allowed and refused call.

Holds are written by triggers that run as their owner, so the API roles
need nothing on `provider_holds` itself. They get no grants on it.

**Kept by triggers:**

| Event | Hold |
| --- | --- |
| A Service booking is created (`pending_payment`, its slot chosen) | `[start, end + buffer)` |
| It becomes `expired`, `declined` or `cancelled` | Deleted |
| It's confirmed, completed or paid out | Kept, so history stays honest; past ones block nothing new |
| An Experience session is scheduled | `[starts_at, starts_at + duration + buffer)` |
| The session is cancelled | Deleted |

**What overlap means:**
- **Two customers race for the same slot:** the second insert fails the
  constraint, and the route answers "That time was just taken. Pick
  another."
- **A provider adds an Experience session over a booked Service:** refused,
  with the same plain message.
- **An unpaid checkout** holds its slot until `reserved_until` (31
  minutes). Then `release-reservations` expires it, as for Experiences, and
  the slot frees.

**Buffers** come from the Service (or the provider's default). An
Experience's buffer is the provider's default.

**Experiences are blocked by holds only** (decided 2026-10-14). A session
can be scheduled outside the provider's weekly hours. It just can't
overlap a booking or another session.

## Booking modes

### Instant

1. The customer picks a slot. `create_service_booking` (replacing
   `create_service_request`) inserts the booking in `pending_payment`, with
   `starts_at` and `ends_at` set from the slot, and the hold. A clash fails
   here, before Stripe.
2. Checkout charges immediately (automatic capture), as for Experiences.
3. A paid checkout moves it straight to `confirmed`. That's a new transition
   for Services in `bookings_guard`; today only Experiences go there.
4. Commission, payout (end + 24h) and cancellation work as today.

### Approve each booking

1. The same insert and hold, so the slot is held from the start.
2. Checkout holds the card (manual capture), as today.
3. Paid becomes `requested`, with `respond_by = min(paid + 48 h, starts_at − 2 h)`.
4. The provider accepts (capture, `confirmed`) or declines (release,
   `declined`, hold deleted). No answer by `respond_by` and
   `expire-requests` expires it, as today.
5. **No choosing among times:** the accept is of the one slot, so
   `{ startsAt }` leaves the accept route. `checkAcceptable` keeps its
   checks.
6. **Too short to approve:** a slot less than 4 hours away can't be
   requested in this mode, because it leaves no time to answer.
   `min_notice` below 4 hours is only offered for Instant Services.

### What changes in the data

- **`starts_at` and `ends_at` are set when the booking is created** (from
  the slot) for both modes.
  - The guard's rule "the start changes only with a status change" becomes
    "a Service booking's start never changes after creation".
  - For approval bookings, `confirmed_at` still marks the accept.
- **`preferred_times` goes** (phase 3). New bookings never use it.
- **The old request path stays only while it's being replaced:** phase 1
  adds the new tables and functions next to it, so the website and its
  tests keep working; phase 3 switches the website over. Phase 3's
  migration then removes `create_service_request`, `preferred_times` and
  the old shape in one step (see "The test data").
- **`bookings.service_mode`** records the mode a booking was made under,
  since the listing's mode can change later.
- **`party_size` stays 1.** The screenshot's guest stepper is a later
  change: price per guest, and capacity per Service.

## The test data

lokl isn't live: the hosted database holds test data only, and production
will be a fresh project. So there's **no transition**: no sunset, no
"Suggest times" fallback, no unenforced overlaps. From launch, a Service
is bookable only once its provider has set hours (decided 2026-10-14).

**Counted on the hosted test database (2026-10-14, read-only):**
- 3 future Experience sessions, 0 future confirmed Service bookings, and no
  overlaps;
- 0 open Service requests;
- 1 Service, with a duration.

**Converting it, in one step:**
- **Phase 1's migration:**
  - every existing Service becomes `approve`;
  - holds are made for future scheduled sessions and future confirmed
    Service bookings, all enforced (there are no overlaps to excuse).
- **Phase 3's migration** (when the website moves to slots):
  - any Service request still open from the old flow is expired by the
    system;
  - `create_service_request` and `preferred_times` are dropped;
  - the shape check becomes "a Service booking has its start and end".

  Test card holds lapse on their own within 7 days. Past bookings keep
  their times.

## Search

**Dates now filter Services too, by real availability.** This replaces the
2026-10-12 decision ("dates filter Experiences only"): the When note
("Dates apply to Experiences…"), "Dates: Experiences only" and the results
page's `datesIgnored` note go. A Service without hours never appears in
dated results.

**`public_browse`** with `p_from` and `p_to` and kind Service keeps a
listing only if it has at least one slot in the range. It does this
through an index-friendly table, not `service_slots` per row:
- **`service_open_days`** (`listing_id`, `on_date`): a listing has a slot
  on that market day.
- It's refreshed for a provider's listings when their schedule, holds or a
  listing's duration, buffer or mode changes (a trigger enqueues; the
  `refresh-open-days` job recomputes), and nightly as the window moves.
- **Stale by at most a minute or so:** good enough for search. The slot
  panel is always live.
- **Measured before relying on it:** a bench like
  `scripts/bench-admin-search.mjs` with 1,000 Services × 180 days. If
  computing on the fly is fast enough, the table isn't built.

**The search bar's quick dates and calendar** stay as built. Only the
copy about Services changes.

## The customer's scheduling panel

A dialog from the listing's booking panel, "Schedule your <Service
title>", built from ui-thing's Dialog and Reka's Calendar.

- **Header:** the Service's photo, title, price and duration, like the
  screenshot. No guest stepper yet: one person per booking, and guests per
  Service come later (decided 2026-10-14).
- **Date strip:**
  - Seven days (Sunday to Saturday) with Previous and Next week buttons, and
    a calendar button for the whole month.
  - Each day is a button named for its date and what it has: "Friday,
    October 16, 24 times" or "Thursday, October 15, no times".
  - Days with no times are struck through, and also `aria-disabled` and
    named so; never colour alone. The chosen day is filled and
    `aria-pressed`.
  - Days are market days, and today is marked from market time, as in the
    search's calendar.
- **Times:**
  - A radio group named "Times on Friday, October 16, Atlanta time (ET)".
    Each radio is one start time ("6:00 AM"), laid out six to a row on wide
    screens and three on phones, each at least 44px.
  - Arrow keys choose, as with lokl's `UiRadioGroup`. This is a dialog, not
    the Navigation Menu, so radios are right here.
  - A polite live region says "24 times on Friday, October 16" when the day
    changes.
- **Choosing a time** shows the summary and the next step:
  - **Instant:** "Fri, Oct 16, 10:00–11:15 AM (Atlanta time) · $175", then
    **Book and pay**.
  - **Approve:** the same, then **Request to book**, with "Your card is held,
    not charged, until <provider> accepts. They answer by <respond_by>."
- **No times in the strip's week:** "No times this week" and a button to
  "Next available: Tue, Oct 20" (from `service_slots` over the window).
- **Taken while choosing:** the insert fails, the slots reload, and the
  message is "That time was just taken. Pick another." Focus moves to the
  times.
- **Address:** a Service at the customer's place still asks for the
  address, after the time.
- **Phones:** full screen, with focus kept inside. Escape returns focus to
  "Check availability".
- **States:** loading shows skeleton times, not blank space. A failed load
  says "Times didn't load. Try again" with a retry button.

## The provider's availability editor

A new dashboard page, **Availability** (`/dashboard/availability`), with
four sections. Each section saves on its own, with "Saved" announced.

1. **Weekly hours:**
   - Each weekday is a row with an "Open" switch.
   - Each interval is two time fields (lokl's time-of-day inputs, market
     time), with "Add hours", "Remove" and "Copy to all weekdays".
   - Errors in words: "Ends before it starts", "Overlaps 9:00–12:00".
2. **Specific dates:** a calendar to pick a date, then "Closed" or custom
   hours. A list of upcoming overrides, each removable.
3. **Time off:** a date range picker (`DateRangePicker`), an optional note,
   and the list.
4. **Booking settings:** the booking window, minimum notice, slot interval
   and default buffer, each with plain help ("Time between bookings, for
   travel").

**Per Service, in the listing editor:**
- Duration (required).
- Buffer (or "Use my default").
- Booking mode: **Customers book instantly** or **I approve each booking**,
  with one line on what each means for the customer and the card.

**Preview:** "Your next 7 days for <Service>" shows the slots the customer
will see, so the provider can check the result.

**Changes that touch bookings:** "Saved. 2 bookings fall outside your new
hours. They're still booked." with links to them.

**Time zone:** shown once at the top: "All times are Atlanta time (ET)."

## Emails

| When | Customer | Provider |
| --- | --- | --- |
| Instant: booked and paid | `customer_booking_confirmed` (Service wording) | `provider_new_booking` (new) |
| Approve: paid, held | `customer_request_sent` (one slot, answer-by time) | `provider_new_request` (one slot; Accept or Decline) |
| Accepted / declined / expired | As today | As today (`provider_request_unanswered`) |

Each email states the time in market time, labelled ("Atlanta time"),
through `formatDateTime(…, marketZone)`. No `.ics` attachment yet; that
fits better with calendar sync.

## The admin view

- **Booking page:** shows the mode (Instant or Approve), the slot, and its
  hold.
- **Provider page:** an availability summary (weekly hours, time off, the
  next open slot) and a read-only link to the provider's calendar view.
- **No editing** of a provider's availability from the admin app. Support
  asks the provider.

## Accessibility

- **Date strip:** buttons with full date names, `aria-pressed` for the
  chosen day, and unavailable days struck through and `aria-disabled` and
  named. Never colour alone.
- **Times:** a labelled radio group, arrow keys selecting at once, each
  44px, and the live region for the count.
- **Every time says its zone** in the group's name and in the summary.
- **Editor:** every field labelled, errors tied to their fields
  (`aria-describedby`), "Saved" announced, and switches with visible
  On and Off words.
- **The dialog** keeps focus inside, Escape closes it, and focus returns.
  Nothing moves under reduced motion.
- **Plain words throughout:** "Customers book instantly", "I approve each
  booking", "Time between bookings".

## Tests

**pgTAP:**
- Overlapping holds are refused across a provider's listings, with
  buffers, and between a Service booking and an Experience session.
- Expired, declined and cancelled bookings release their holds.
- Another provider's identical time is allowed.
- Schedule tables: providers read and write their own rows and no one
  else's. Admins read all. Visitors read none.
- `service_slots`: callable by visitors; `function_privileges` list
  updated.
- `btree_gist` functions: each allowed and refused call.
- `bookings_guard`: Instant Services go from `pending_payment` to
  `confirmed`, and a Service booking's start can't change.
- `create_service_booking`: refuses a slot outside the hours, inside the
  notice, beyond the window, on time off or taken.
- Each rule has an allowed case and a blocked case.

**App tests** (`supabase/tests/app/`), for slot building:
- intervals and duration fit;
- the slot interval;
- notice and window;
- overrides, closed days and time off;
- buffers at the edges;
- an Experience session blocking a Service;
- the March and November clock changes;
- run with the device in Tokyo and in Los Angeles.

**App tests, other:**
- **The race:** two customers, one slot, and exactly one booking created.
- **The test-data conversion:** existing Services become Approve; holds
  for future sessions and bookings.
- **Search:** dates filter Services by open days; Services without hours
  never appear in dated results.

**E2e journeys:**
- **Instant booking:** the date strip and times by keyboard, pay, confirmed.
- **Approval booking:** request, the provider accepts and the card is
  captured, and the decline path.
- **The editor by keyboard:** weekly hours, a closed date, time off and the
  preview.
- **A slot taken while choosing.**
- **Search with dates** returning only Services free on those days.
- **Phone width** for the panel and the editor.

Every test fails on the old code first, with a deliberate break.

## Phases

1. **Data:** schedules, holds and the exclusion constraint, `service_slots`,
   `create_service_booking`, and guard changes. Migrations and pgTAP, shown
   before `db:push`.
2. **Provider editor** and the per-Service settings.
3. **Customer panel, both modes,** emails, and the admin view.
4. **Search** by availability.
5. **Later: Google Calendar sync** (below).

Each phase ships on its own, with the full checks.

## Later: Google Calendar sync

- **Import busy times:** the provider connects Google (OAuth, scope
  `calendar.freebusy` or `calendar.readonly`), picks calendars, and their
  busy times become holds of a third kind, `external`. These are enforced
  like the others.
  - A job polls free/busy every few minutes for the booking window.
  - Push notifications (watch channels) can come later.
- **Export bookings:** confirmed bookings are written as events to a "lokl"
  calendar (scope `calendar.events` on that calendar only). The events have
  no customer contact details beyond a first name and the address the
  provider already sees.
- **Tokens:** server-only, encrypted at rest, never in logs (`logText()`),
  and revocable from the editor. Disconnecting deletes the tokens and the
  external holds.
- **Conflicts:** an external event over an existing booking doesn't cancel
  it. The provider sees a warning on the booking.
- **This needs its own design doc:** the data shared with Google, and
  Google's app verification for these scopes, which takes weeks.

## Later: team members

Holds assume each provider is one person: one provider's bookings and
sessions can never overlap. When businesses get team members, a hold
should belong to the team member doing the work (`provider_holds` gains a
`member_id`, and the exclusion constraint compares the member instead of
the provider), so a business can run simultaneous sessions with different
people. Each member then gets their own hours, and a slot is open when a
member who offers that Service is free.

## Answers (2026-10-14)

1. **No default mode:** the provider chooses Instant or Approve when
   creating a Service. Existing test Services become Approve.
2. **No transition:** lokl isn't live, so the test data is converted in one
   step (above), and a Service is bookable only once its provider has set
   hours.
3. **Approval:** answer by `min(48 h, start − 2 h)`, with at least 4 hours'
   notice.
4. **Buffers after each booking only:** `[start, end + buffer)`.
5. **Guests per Service:** later.
6. **Experiences** are blocked by holds only.

## Decisions this replaces (to record when approved)

- 2026-09-27: "Services: request and confirm… providers don't keep a
  calendar." It becomes availability with two modes.
- "Up to three preferred times." It becomes one chosen slot.
- "Overlaps warn but never block." It becomes refused by the database.
- 2026-10-12: "Dates filter Experiences only and never hide Services." It
  becomes dates filter Services by availability.
