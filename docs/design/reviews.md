# Reviews and star ratings

Status: **built** (2026-10-04; migrations `reviews` and `review_star_counts`),
as approved, with the answers to the open questions and the reviewer-name
rules (see "Decisions on the open questions") and the notes under "As built". The third of
three planned features (provider profiles and favourites are built;
[docs/TODO.md](../TODO.md), Next features). Builds on the principles agreed
on 2026-10-04 ([docs/decisions.md](../decisions.md)) and the nine decisions
below.

## What it is

A customer whose booking took place gives it one to five stars and a few
words. The review shows on the listing's page at once. The provider can post
one public reply. Anyone signed in can report a review or a reply, and an
admin judges reports against written rules. Below three reviews, people see
the reviews themselves and "New on lokl", not an average.

## Decided (2026-10-04)

1. One overall star rating (1 to 5) plus written text. No category ratings
   yet.
2. The average shows only from **3 reviews**; below that, the reviews
   themselves and "New on lokl".
3. A **14-day window** after the booking ends, with **one reminder** email
   if they haven't reviewed.
4. A review belongs to a **booking and its listing**. The listing page shows
   the listing's rating; the profile card and profile page show the
   **provider's combined** rating.
5. Customers can **edit** their review until the window closes; providers
   can edit their reply.
6. Only **completed** bookings qualify: not cancelled ones, nor no-shows
   resolved in the customer's favour.
7. A **Report** link on each review, feeding an admin moderation queue
   judged against the written rules; removals logged, with reasons.
8. **No incentives** for reviews, from lokl or providers.
9. Reviews appear **as soon as they're submitted**.

From the principles: one review per booking; one-sided (providers don't
review customers); one public reply per review; rules that never remove an
honest negative review (the FTC's 2024 rule on consumer reviews).

## Who can review, and when

A booking can be reviewed by its customer when **all** of these hold:

- Its status is `completed` or `paid_out`, and it was never cancelled
  (`cancelled_at` is empty). This rules out cancelled bookings, a
  customer's late cancel that was paid out (`cancelled` → `paid_out`), and a
  no-show resolved as a refund (that cancels the booking).
- Its end (`ends_at`) was less than **14 days** ago.
- It has **no open no-show report**. A report resolved as "pay the
  provider" lets the review go ahead; one resolved as a refund cancels the
  booking, so it never qualifies.
- It hasn't been reviewed already (one per booking; a group booking of four
  is one review).

`completed` is set by the `pay-out` job once the booking has ended. The
window is counted from `ends_at`, not from when the job ran, so a late job
doesn't lengthen it. (No scheduler runs the jobs yet: docs/TODO.md.)

Editing and deleting follow the same window: until 14 days after the end.
After that the review is final, apart from moderation. The reply has no
window.

**A booking cancelled after it was reviewed** (a later refund, or a no-show
report resolved in the customer's favour after they reviewed) **keeps its
review**: hiding an honest review automatically would be suppression. A
review comes down only through the written rules.

## Tables and access rules

Three new tables and two rating totals, plus new `admin_actions` values. A
customer can delete their own review while the window is open (and write
again); otherwise reviews are never deleted, and a removal is a status.

| Table | Columns | Delete |
| --- | --- | --- |
| `reviews` | `id`; `booking_id` (unique, → bookings); `listing_id`, `provider_id`, `customer_id` (copied from the booking by a trigger; never sent); `reviewer_name` ("Sam T.", from the booking's name by the rules under "The reviewer's name", set by the trigger); `booking_month` (the month of the booking, in its market's time); `rating` (1 to 5); `body` (20 to 2,000 characters, no contact details); `created_at`, `edited_at`; `status` (`published`, `removed`); `removed_at`, `removed_rule`, `removed_reason` | by its customer, while the window is open and it's published (its reply and reports go with it); otherwise never |
| `review_replies` | `review_id` (primary key, → reviews: one reply per review); `provider_id` (copied by the trigger); `body` (1 to 1,500 characters, no contact details); `created_at`, `edited_at`; `status`, `removed_at`, `removed_rule`, `removed_reason` | never |
| `review_reports` | `id`; `review_id`; `target` (`review` or `reply`); `reporter_id`; `rule` (which written rule it breaks, or "something else"); `note` (optional, up to 1,000); `created_at`; `status` (`open`, `upheld`, `dismissed`), `resolved_at`, `resolved_by`, `resolution_note` | never |

Unique: one report per person per review and target.

**Row rules (RLS):**

| Who | `reviews` | `review_replies` | `review_reports` |
| --- | --- | --- | --- |
| Visitors (anon) | read **published** reviews whose provider's profile is public, public columns only (no `customer_id`, `booking_id`, removal details) | read published replies to those reviews | nothing |
| The customer | the above; their own in any status through `review_state()` (with the rule if removed); **insert** only for their own booking while it qualifies (above); **update** `rating` and `body`, and **delete**, only while the window is open and it's published | read | insert their own reports; read their own |
| The provider | the above; read **all** their reviews, including removed ones (the rule, not the admin's note) | **insert** and **update** `body` on their own reviews' reply, while the review is published and they're active; **delete** their own reply (also how a removed reply is written again); read their own in any status | insert reports on their own reviews; read their own |
| Admins | read everything | read everything | read everything |
| Server only (service role, through admin functions) | `status` and removal columns | the same | `status` and resolution columns |

Apart from a customer deleting their own review in the window (and a
provider deleting their own reply), no one deletes rows from the apps. Column grants leave the copied ids, the
name and every status or moderation column out of `insert` and `update`. A
signed-in user can't review their own listing: they can't book it (already
enforced on bookings).

**Contact details** are refused in reviews and replies, by the form and by
the database (`has_contact_details()`, as on profiles), with the same
message naming what it looks like. A private-information rule (below)
covers what the check misses.

**Functions:**

- `review_state(booking_id)`: for the customer's and the provider's
  booking pages: can write, edit or delete, or why not; the window's end;
  the name the review shows (or will show); the review and reply in any
  status, with the rule if removed. Security definer, the booking's own
  customer or provider only.
- `listing_ratings` and `provider_ratings`: each listing's and provider's
  count of published reviews, star total and average (a generated column),
  **kept up to date by the database**: a trigger on `reviews` recounts the
  listing and provider whenever a review is posted, edited, deleted,
  removed or restored. Pages and cards read them; nothing is calculated
  per page load. Readable as far as the listing or provider is.
- `admin_review_reports_page(...)`: the moderation queue (below).
- `admin_moderate_review(...)`: remove or restore a review or reply,
  resolve its reports, log it in `admin_actions` and queue the email, in one
  transaction (the pattern of `admin_remove_provider_profile_content`).

## The reviewer's name

Made by the database from the free-text name on the booking (the trigger
sets `reviewer_name`; `review_state()` returns the same for the form, so the
form shows exactly what will appear):

1. Split into words on spaces; from each word keep only letters (any
   alphabet), hyphens and apostrophes; drop words with no letters left.
2. Tidy capitals: a word typed all in lower case or all in capitals gets a
   capital first letter, after each hyphen too ("sam" and "SAM" → "Sam",
   "mary-jane" → "Mary-Jane"); mixed case is left as typed ("DeShawn").
3. Two or more words: the first word and the last word's initial, "Sam T."
   ("sam taylor-brown" → "Sam T."; "José María López" → "José L.").
4. One word: shown as is (tidied), "Cher".
5. Nothing usable left (digits, emoji, symbols, empty): "A lokl customer".

The name is copied when the review is posted, so a later change to the
booking's name doesn't change it.

## Ratings: how they're calculated and shown

- **Listing rating:** published reviews of that listing.
- **Provider rating:** published reviews of **all** their listings,
  including listings no longer live (otherwise unlisting a listing would
  shed its reviews).
- **Average:** the plain mean of the stars, rounded to one decimal
  (half up): 4.75 → 4.8. No weighting.
- **Shown from 3 reviews.** Removed reviews don't count.

| Reviews | The rating line | Screen-reader text |
| --- | --- | --- |
| 0 | "New on lokl" | the same |
| 1 or 2 | "New on lokl · 2 reviews" (a link to them) | "New on lokl, 2 reviews" |
| 3 or more | "★ 4.8 · 12 reviews" | "Rated 4.8 out of 5 from 12 reviews" |

The star is decorative (`aria-hidden`); the number and the words carry the
meaning, never the colour or the number of filled stars alone.

**Where (the spaces the profile design left):**

```
Listing page                                   Profile page
┌───────────────────────────────────┐          ┌──────────────────────────┐
│ Food walk in old forth            │          │ (avatar)                 │
│ Sweet Auburn Food Walk        (♡) │          │ Peach Tours          (♡) │
│ ★ 4.8 · 12 reviews   ← listing    │          │ ★ 4.7 · 31 reviews  ← all│
│ Old Fourth Ward, Atlanta          │          │ Food walks through …     │
│ …                                 │          │ …                        │
│ About                             │          │ About Peach Tours        │
│ Reviews (12)       ← new section  │          │ Reviews (31) ← new       │
│ Hosted by: Peach Tours ★ 4.7 (31) │          │ Experiences / Services   │
└───────────────────────────────────┘          └──────────────────────────┘
```

- **Listing page:** the rating line directly under the title, the same size
  as the category line (it links to the Reviews section); a **Reviews**
  section after "About" and the dates; the profile card shows the
  provider's combined rating beside the business name.
- **Profile page:** the rating line under the business name; a **Reviews**
  section after "About", each review naming the listing it's for (a link,
  while that listing is live).
- **Listing cards:** "★ 4.8 (12)" from 3 reviews (screen readers: "Rated
  4.8 out of 5 from 12 reviews"); nothing below 3, so cards don't fill with
  "New on lokl".

**Each review shows:** the stars as "★★★★☆" with "4 out of 5" for screen
readers; the reviewer's name ("Sam T.", below); "Booked October 2026" (the
booking's month: every review is from a real booking, so no "verified"
badge is needed); the text; "Edited" if changed; then the provider's reply,
indented, with their avatar and name, "Reply from Peach Tours". Newest
first, 10 at a time with **Show more**. No sorting by stars, and no hiding
low ones.

**Caching:** listing pages aren't cached, so a review shows there at once.
Profile pages are cached for 60 seconds (`/api/public/providers/**`), so it
shows there within a minute. Removals are the same: at once on the listing,
within a minute on the profile (the TODO item on clearing cached pages
covers this too).

## The review form

On the customer's booking page (`/account/bookings/:id`), in a **Your
review** section, shown while the booking qualifies:

- **Stars:** ui-thing's radio group, styled as five stars: a group named
  "Your rating" with five radio buttons, "1 star: Poor", "2 stars: Fair",
  "3 stars: Good", "4 stars: Very good", "5 stars: Excellent". The arrow
  keys move between them; filled stars up to the choice, and the chosen
  label written beside them (never the stars alone).
- **Text:** "Tell others about it", 20 to 2,000 characters, with a counter;
  hint "What was it like? What should others know before booking?".
  Contact details refused with the profile message.
- **Post review.** A plain line under it, with the name exactly as it will
  appear (from the database's own rule): "Your review will show as Sam T.
  You can edit or delete it until Oct 20."
- After posting: "Thanks. Your review is up." with a link to see it on the
  listing. The section then shows the review with **Edit** and **Delete**
  until the window closes, then without. Deleting asks first ("Delete your
  review? You can write a new one until Oct 20.").
- Outside the window, or a booking that doesn't qualify: nothing to write;
  past bookings that could have been reviewed say "Reviews close 14 days
  after the booking."

**Validation, twice:** the form (zod schema in `@repo/types`) and the
database (checks and the insert rule), as everywhere else.

The emails link straight to the section (`/account/bookings/:id#review`);
signed out, the page's usual sign-in applies and returns there.

## Emails

Through the booking email outbox (`booking_emails`, one per booking and
kind), with the existing sending, retries and admin retry:

| Email | To | Queued when |
| --- | --- | --- |
| `customer_review_request` | customer | the booking becomes `completed` and qualifies (no open report). If a report is open, when it's resolved as "pay the provider" |
| `customer_review_reminder` | customer | a new job, `review-reminders`: once, 4 days before the window closes (day 10), if they haven't reviewed and it still qualifies |
| `customer_review_removed` | customer | an admin removes their review: the rule, in plain words, and that it can't be posted again |
| `provider_new_review` | provider | a review is posted |
| `provider_reply_removed` | provider | an admin removes their reply: the rule; they can write a new one |

**The request**, plain and the same for everyone (no incentive, no hint to
leave a good review):

> Subject: How was Sweet Auburn Food Walk?
>
> Thanks for booking with Peach Tours on Oct 6. If you have a minute,
> tell others what it was like: give it one to five stars and a few words.
>
> [Write a review]
>
> You can write it until Oct 20. Reviews are public and show your first
> name and last initial.

**The reminder:** "4 days left to review Sweet Auburn Food Walk", the same
body. Only one.

Not emailed: edits, and replies to a customer's review (a "reply to your
review" email can come later). Each kind is sent once per booking (the
outbox's rule): a review deleted and written again doesn't email the
provider twice, and a second removal after a restore isn't emailed.

A **bell notification** for the provider on each new review (a new
notification kind, `review_posted`), linking to it.

## Provider replies

- On the provider's booking page (`/dashboard/bookings/:id`) and a new
  dashboard page, **Reviews** (all their reviews, newest first, with the
  listing, unreplied ones first), each with **Reply** or **Edit reply**.
- One reply per review, 1 to 1,500 characters, contact details refused,
  editable at any time; "Edited" shown when changed.
- A line under the box: "Your reply is public. Keep it about the booking.
  Don't share the customer's details or offer anything in return for
  changing the review."
- Not on removed reviews. A removed reply can be written again (the rules
  apply to its words, not to replying).
- Providers can't edit, hide or remove reviews; they can **report** one like
  anyone else, marked "reported by the provider" in the queue.

## Reporting and moderation

**Report.** A "Report" link on each review and each reply (a small text
button, its name "Report Sam T.'s review" or "Report the reply"). It opens
a dialog:

- "Which rule does it break?": a radio group of the written rules, plus
  "Something else".
- "Anything we should know? (optional)".
- **Send report** → "Thanks. We'll look at it against our review rules."
  The review stays up while it's looked at (decision 9).
- Signed out: the sign-in dialog first ("Sign in to report a review"), so
  reports come from accounts and can't be sent in bulk anonymously.
- One report per person per review (and per reply); a second says "You've
  already reported this."

**The admin's queue**, a new admin page, **Reviews**, under Content:

- Open reports, oldest first, grouped by review: the review and reply, the
  listing and provider, each report's rule and note, who reported it
  (customer, provider, or someone else; no names shown beyond the account's
  email on request), and earlier removals for the same provider or customer.
- The written rules beside it.
- Actions, each with a reason of 5+ characters:
  - **Remove the review** (or **the reply**), choosing the rule it breaks:
    it's hidden everywhere at once, drops out of the ratings, the reports
    are marked upheld, the author gets the email with the rule.
  - **Keep it** (dismiss the reports), saying why. The reporter isn't
    emailed.
  - **Restore** a removed review or reply (a mistake), logged the same way.
- Every action is logged in `admin_actions` (`remove_review`,
  `restore_review`, `dismiss_review_reports`) with the admin, the rule and
  the reason, in the same transaction as the change.
- The dashboard's "Needs attention" gains **Review reports to check**.
- A filter for all reviews (by provider, listing, stars, removed) for
  context, with the same actions.

**Decisions are made against the rules only.** Being negative, a low star
rating, or the provider disagreeing are never reasons to remove.

## The written review rules

Published on a public page, `/review-rules`, linked from the review form,
the reply box, the report dialog and the request email. Plain language:

> **Reviews on lokl**
>
> Reviews are from customers whose booking took place. Each booking can be
> reviewed once, within 14 days of its end.
>
> **We remove a review or a reply only if it:**
>
> 1. **Is abusive:** threats, harassment, hate, or insults aimed at a person.
> 2. **Shares private information:** phone numbers, email or home addresses,
>    or another person's full name or personal details. (A first name, like
>    "our guide Marcus", is fine.)
> 3. **Isn't about the booking:** for example about a different business, or
>    about politics or other topics unrelated to it.
> 4. **Advertises or spams:** links, promotions, or the same text posted
>    again and again.
> 5. **Is sexual or describes illegal activity.**
> 6. **Comes from a conflict of interest:** the business reviewing itself,
>    or a review written in return for something (a discount, a refund, a
>    gift).
>
> **We never remove a review because it's negative**, because of its star
> rating, or because the business disagrees with it. Businesses can reply
> publicly instead.
>
> **No rewards for reviews.** lokl never offers anything for a review, and
> businesses on lokl must not either: no discounts, refunds, gifts or
> favours for writing, changing or removing one, and no asking only happy
> customers. Report it if you're offered something.
>
> If we remove your review or reply, we email you which rule it broke.

The same six rules are the report reasons and the admin's removal reasons
(a shared list in `@repo/types`, like `PROFILE_RULES`). The provider terms
(still to be written, docs/TODO.md) should include the no-incentives rule;
noted there.

## Building it

1. **Database:** the three tables, triggers (copying the booking's ids and
   name; contact details; the window), row rules and column grants,
   `review_state`, the rating totals, the admin functions, the email
   kinds and triggers, the notification kind, the `admin_actions` values.
   pgTAP tests (below).
2. **Shared:** the review schema and `REVIEW_RULES` in `@repo/types`; a
   `ReviewStars` display and the star radio group in `packages/ui`.
3. **Customer:** the form on the booking page; the request and reminder
   emails; the `review-reminders` job.
4. **Public:** the rating lines, the Reviews sections, the profile card's
   rating, Report; `/review-rules`.
5. **Provider:** replies on the booking page and the Reviews page; the bell
   notification and email.
6. **Admin:** the Reviews queue, the actions, the dashboard line.
7. **Docs:** this design marked built; `booking-and-payments.md` (the new
   emails and job, since they hang off booking states); decisions; TODO.

## Tests

**pgTAP (access rules, each with the allowed and the blocked case):**

- A customer reviews their own completed booking within 14 days; not
  someone else's; not a cancelled one, a late-cancel-then-paid-out one, one
  with an open no-show report, or one past 14 days; not twice.
- They can't set the copied ids, the name or the status; the trigger fills
  them from the booking.
- They edit `rating` and `body` only, only in the window, only while
  published.
- Visitors read published reviews and replies of public providers, without
  `customer_id` or removal details; not removed ones; nothing of a
  suspended provider.
- The provider reads all their reviews, writes one reply to each of theirs,
  edits it; not to another provider's, not on a removed review; can't edit
  or hide the review.
- Reports: anyone signed in, once per target; visitors can't; nobody but
  admins reads others' reports.
- The rating totals: removed and deleted reviews excluded; listing and provider sums;
  rounding (4.75 → 4.8); a provider's unlisted listing still counts.
- Admin moderation: remove, restore, dismiss; each logged with the rule and
  reason, the email queued, the reports resolved; a non-admin refused.
- Contact details refused in a review and a reply.
- The emails: the request on completion (not with an open report; on
  resolution as "pay the provider"), once; not for a cancelled booking.
- Deliberate breaks: a missing window check, a missing "never cancelled"
  check, a read rule that shows removed reviews.

**App tests:** the `review-reminders` job (day 10, once, not after
reviewing, not past the window); the email templates (`test:emails`); the
rounding and display text (`test:ui`).

**End-to-end (journey 11):**

- A completed booking: the customer opens the request email's link (Mailpit),
  rates with the keyboard (arrow keys, the labels read out), writes, posts;
  the review is on the listing page at once; edits it.
- The rating line: "New on lokl" with 0, "New on lokl · 2 reviews" with 2,
  "★ … · 3 reviews" with 3 (made through the test data), on the listing,
  the profile card and the profile page.
- The provider replies and edits the reply; it shows under the review.
- A visitor reports a review (signing in through the dialog); the admin
  removes it with a rule; it's gone from the page and the average; the
  customer's email names the rule; the log has it. Another report is
  dismissed and the review stays.
- Contact details in a review are refused with the message.
- Outside the window: no form, and the line saying reviews close after 14
  days.

## As built (2026-10-04)

- **Stars:** shown with ui-thing's `UiRating` (`ReviewStars`), hidden from
  screen readers with the words beside it. The form doesn't use it: its
  stars are click-only shapes, with no keyboard use, no names and no value
  in words. The form is ui-thing's radio group drawn as stars
  (`StarRatingInput`): a group named "Your rating", five radios named
  "1 star: Poor" to "5 stars: Excellent", moved with the arrow keys, and the
  chosen value written beside them.
- **The breakdown** (owner's request, 2026-10-04): at the top of the
  Reviews section on listing and profile pages from 3 reviews, the average
  and each star level with a bar, its count and share; each row reads as
  text ("5 stars: 8 reviews, 67%"), the bars are hidden from screen
  readers. The counts per star level are kept by the database with the
  others (migration `review_star_counts`).
- **Who reads what:** visitors read through the public API routes
  (`/api/public/reviews`, not cached); the customer's and provider's
  booking pages through `review_state()`; the provider's Reviews page
  (`/dashboard/reviews`, unreplied first) through a provider-only server
  route, since the booking a review belongs to isn't readable through the
  API.
- **Reporting signed out:** Report opens the sign-in dialog ("Sign in to
  report a review"), then the report dialog once signed in.
- **Admin:** Content → Reviews (`/content/reviews`): the reported queue and
  all reviews, filtered by status and stars; remove (naming the rule, which
  is preselected from the report), keep and restore, each with a reason,
  through the website (`/api/admin/reviews/:id/moderate`). The dashboard's
  "Needs attention" counts "Review reports to check".
- **Emails** never include the review's or reply's words (emails get
  forwarded); the provider hears the stars. They're skipped when they no
  longer apply (see docs/architecture/booking-and-payments.md).
- **The `review-reminders` job** queues the reminders; it runs for every
  booking (it refuses the development one-booking option). Like the other
  jobs, nothing schedules it yet (docs/TODO.md).
- **Tests:** pgTAP `reviews.test.sql` (117 checks); `test:emails` (the five
  review emails, the skips); `test:ui` (the rating words); end-to-end
  journey 11 (five tests). Deliberate breaks caught: a late cancel
  qualifying, no window, removed reviews public, reporting your own review,
  star counts swapped, breakdown shares wrong, the report not carried on
  after signing in, the stars without names.

## Decisions on the open questions (2026-10-04)

1. **The reviewer's name:** "Sam T.", from the booking's name, by the rules
   above, shown in the form exactly as it will appear; "A lokl customer"
   when nothing usable is left.
2. **Deleting:** customers can delete their own review while the window is
   open, and write again.
3. **A booking cancelled after it was reviewed keeps its review.** Never
   hide an honest review automatically: that's suppression. Removal only
   through the written rules.
4. **Listing cards** show "★ 4.8 (12)" from 3 reviews, with each listing's
   count and average kept up to date by the database, not calculated per
   page load.
5. **A new review:** a bell notification and an email to the provider.
6. **A 20-character minimum.**

## Open questions (resolved: see above)

1. **The reviewer's name:** first name and last initial from the name on
   the booking, "Sam T." (recommended: real enough to trust, little
   exposure), or first name only, or no name ("A lokl customer")?
2. **Deleting a review:** let the customer delete their own while the
   window is open, and write again (recommended: it's their words), or edit
   only, with deletion through support?
3. **A booking cancelled after it was reviewed** (an admin refund later, or
   a no-show report resolved in the customer's favour after they reviewed):
   hide the review automatically, since the booking no longer qualifies
   (recommended, decision 6; the customer is told, and it isn't logged as a
   moderation removal), or keep it?
4. **Listing cards:** leave ratings off cards for now (recommended: the
   decisions name the listing page and the profile; cards can follow once
   there are enough reviews to matter), or add "★ 4.8 (12)" to cards from
   3 reviews?
5. **Telling the provider about a new review:** a bell notification and an
   email (recommended: so they can reply while it's fresh), or the bell
   only?
6. **Minimum length:** 20 characters (recommended: a sentence, not just
   "ok"), or none?
