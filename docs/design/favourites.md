# Favourites ("Saved")

Status: **built** (2026-10-04; migration `saved_items`), as approved, with
the recommendation on every open question and one refinement to unavailable
names (see Decisions; As built). The second of three planned
features: provider profiles (built), favourites, reviews
([docs/TODO.md](../TODO.md), Next features).

## What it is

A signed-in customer taps a heart to save a listing or a provider, and finds
everything they saved on one **Saved** page in their account. One list for
now; named collections ("Date night", "Visiting family") later.

## Decided

- One **Saved** list per customer. Named collections later.
- Customers save **listings and providers**: a heart on every listing card,
  every listing page and every provider profile.
- A **signed-out visitor** who taps a heart is asked to sign in, then
  returned to the same page with it saved.
- Saved items are **private**: providers never see who saved them. No counts
  shown, for now.
- A saved listing or provider that's **no longer available** stays in the
  list, marked unavailable.
- The heart is a **real button** with an accessible name and state.
- It **updates instantly** when tapped, and **undoes itself** with a message
  if saving fails.
- A **Saved** page in the account, reachable from the account menu.

## Tables and access rules

Two small tables, one per kind, so each has a real foreign key (rather than
one table with a "kind" and an id that points at either):

| Table | Columns | Primary key | Deleted when |
| --- | --- | --- | --- |
| `saved_listings` | `customer_id` → auth.users, `listing_id` → listings, `created_at` | (customer_id, listing_id) | the customer's login is deleted, or the listing is (cascade; only draft listings are ever deleted, so in practice only the first) |
| `saved_providers` | `customer_id` → auth.users, `provider_id` → providers, `created_at` | (customer_id, provider_id) | the customer's login is deleted (providers are never deleted) |

The primary key makes saving twice harmless: the second save is a no-op.

**Row rules (RLS), per table:**

| Who | Read | Save (insert) | Unsave (delete) | Change (update) |
| --- | --- | --- | --- | --- |
| The customer, their own rows | yes | yes, **only something visible now** (a live listing with an active provider, category and city; a provider with a public profile) | yes, always (including something no longer visible) | no (nothing to change) |
| Any other signed-in user, including the provider whose listing it is | no | no | no | no |
| Admins | **no** (see open question 2) | no | no | no |
| Signed-out visitors | no | no | no | no |

So a provider can never learn who saved their listing: there's no rule that
lets them read the rows, and no count anywhere.

**Reading the Saved page.** A customer can't read a listing that's no longer
visible (that's the public read rule), so a plain join would drop unavailable
items, or show nothing to name them by. One function does the reading:

- `my_saved()`: **security definer**, for the signed-in user only
  (`auth.uid()`), returning their saved items, newest first, each with
  `available` (true or false) and only public fields: for a listing its kind,
  title, address (slug), price, market, area and cover photo; for a provider
  their name, profile address, avatar and headline.
- For an **unavailable** item it returns `available: false` and, at most,
  its name: no photo, price or link. **Whether the name is shown** depends on
  why it's unavailable:
  - lokl took the listing down (unpublished, or rejected on review), or the
    provider was **suspended**: no name. The page shows "A listing that's no
    longer available" or "A provider who's no longer available", since the
    reason may have been its content;
  - the provider **unlisted** it themselves (back to a draft), or its
    category or market closed: its own title, or the business name.
- The website then loads the **available** items as a visitor would see
  them (the normal listing cards and profile details).
- It never returns anything a signed-out visitor couldn't see, or anything
  about other customers.

**The hearts' state** on public pages comes from a lighter read: the
customer's own saved ids (`saved_listings`, `saved_providers` under the row
rules above), loaded once per page visit, in the browser.

**Limit:** 500 saved items per kind per customer, enforced by the database
on save (a plain message beyond it). *Open question 3.*

## The heart

One component, `SaveButton`, used everywhere a heart appears.

**Markup and accessibility**

- A `<button type="button">`, 44 × 44 pixels, with a heart icon: outlined
  when not saved, filled when saved.
- **Name and state**, the toggle-button pattern: the name stays the same and
  the state changes, so screen readers say "Save Sweet Auburn Food Walk,
  toggle button, not pressed", then "…, pressed":
  - `aria-label="Save Sweet Auburn Food Walk"` (for a provider: "Save Peach
    Tours").
  - `aria-pressed="true"` when saved.
  - A visible tooltip on hover and focus: "Save" or "Saved".
  - After a tap, a polite announcement in a live region: "Saved Sweet Auburn
    Food Walk" or "Removed Sweet Auburn Food Walk from Saved".
  - This differs slightly from the wording in Decided ("Saved" as the name
    once saved): changing a button's name as it toggles is confusing for
    screen-reader users, and the pressed state already says it. *Open
    question 1.*
- Never colour alone: filled versus outlined, plus the pressed state and the
  tooltip's words.
- Works with Enter and Space; visible focus ring.

**Behaviour**

1. **Signed in:** the heart flips at once. The save (or unsave) is sent to
   the database in the background.
2. **If it fails** (offline, the listing just came down, the limit), the
   heart flips back and a toast says why in plain words: "Sweet Auburn Food
   Walk wasn't saved. Check your connection and try again." or "This listing
   isn't available any more, so it can't be saved."
3. **Signed out:** the tap asks the visitor to sign in (below).
4. **Rapid taps:** each tap flips the heart; only the last state is sent, so
   tapping save-unsave-save quickly ends saved, with one request.

**Where it goes**

| Place | Position |
| --- | --- |
| Listing cards (browse pages, "More from", guides' listings blocks, the market page) | over the photo's top right corner, beside the card's link, not inside it (a button inside a link is invalid and confusing). The card's link and the heart are two separate tab stops. |
| Listing page | top right of the title block: the room left for it in the profile design. |
| Provider profile page | beside the business name: the room left for it there. |

The profile card on a listing page doesn't get a heart (the listing's own
heart is right above it); the profile page does.

**Before the saved ids have loaded,** hearts render as not saved but don't
respond to taps (they announce nothing), so a fast tap can't unsave
something already saved. Public pages are built as a signed-out visitor
sees them (and some are cached for a minute), so the hearts' state is always
filled in by the browser.

## The sign-in return trip

Today "Sign in to book" saves the page's address in the sign-in module's
redirect cookie, and the emailed link brings the visitor back to it. Saving
does the same, plus one thing: what they were saving.

1. A signed-out visitor taps a heart.
2. A small dialog: "Sign in to save Sweet Auburn Food Walk. Saved items stay
   in your account." with **Sign in** and **Not now**. (No dialog, and they
   might lose their place before understanding why the page changed.)
3. **Sign in** stores two things, then goes to `/login`:
   - the page's address, in the existing redirect cookie;
   - the intent, in a short-lived cookie, `lokl_save_intent`: the kind and
     id, and when, valid for 30 minutes. A cookie, not session storage,
     because the emailed link may open in a new tab of the same browser.
4. They sign in by email as usual and land back on the same page.
5. On that page, once they're signed in, the intent is read **once** and
   cleared: the item is saved, its heart is shown filled, and a toast says
   "Saved Sweet Auburn Food Walk."
   - Already saved: the toast says the same (nothing changes).
   - No longer available: "This listing isn't available any more, so it
     wasn't saved."
   - The intent is older than 30 minutes, or for an item not on this page:
     it's dropped silently.
6. A visitor who never signs in leaves nothing behind but the expiring
   cookie.

A provider or an admin signing in this way gets the same, since anyone signed
in can save.

## The Saved page

`/account/saved`, linked as **Saved** in the account menu (between "My
bookings" and the provider's "Dashboard"), and from the account pages' own
navigation.

- **Listings** first, then **Providers**, each newest saved first, with
  counts in the headings ("Listings (4)").
- Listings use the normal listing cards, with their heart (filled), so
  unsaving works the same as everywhere else.
- Providers show as small cards: avatar, business name, headline, a link to
  the profile, and the heart.
- **Unavailable items** stay, at the end of their section, as plain rows: the
  name, "No longer available", and a **Remove** button. No photo, price or
  link.
- **Empty:** "Nothing saved yet. Tap the heart on a listing or a provider to
  keep it here." with links to browse Experiences and Services.
- **Unsaving on this page** doesn't remove the card at once: it stays,
  greyed, with its heart empty and "Removed. Undo" for the rest of the visit,
  so a slip of the finger is easy to undo. It's gone on the next visit.
- The page isn't indexed (`robots: false`, like the rest of `/account`), and
  needs sign-in (`/account*` already does).

## Building it

1. **Database:** the two tables, their row rules and comments, the limit,
   `my_saved()`. pgTAP:
   - a customer saves, reads and unsaves their own;
   - they can't save something not visible (a draft, a suspended provider's
     listing, a provider with no live listing);
   - another customer and the provider can't read the rows; signed-out
     visitors can't do anything;
   - saving twice is one row; the limit is enforced;
   - `my_saved()` returns only the caller's, marks unavailable items, and
     returns only the name for them;
   - deliberate breaks: a provider read rule, and a missing visibility check.
2. **The heart:** `useSaved()` (the saved ids, optimistic updates, undo on
   failure, the last-tap-wins rule) and `SaveButton`; on listing cards, the
   listing page and the profile page.
3. **The return trip:** the dialog, the intent cookie, saving on return.
4. **The Saved page** and the account menu link.

**End-to-end tests:**

- A signed-in customer saves a listing from a browse card and a provider
  from their profile; the hearts show saved on reload; the Saved page lists
  both; unsaving from the Saved page shows "Removed. Undo", and Undo saves
  again.
- A signed-out visitor taps a heart on a listing page, signs in through the
  emailed link (as journey 5), and lands back on the page with it saved and
  the toast shown.
- Saving fails (the request is made to fail in the test): the heart flips
  back and the message shows.
- A saved listing is unpublished: it shows as "No longer available" with
  Remove, and no photo or link.
- Keyboard and screen reader: the heart is reachable by Tab, toggles with
  Enter and Space, and its name and pressed state are right.
- A provider looking at their own listing's data can't find who saved it
  (the pgTAP covers the rules; the end-to-end test checks no page shows it).

## Decisions (2026-10-04)

1. The heart keeps a **constant name** ("Save Sweet Auburn Food Walk") and
   shows saved through its **pressed state**.
2. **Admins can't read** saved items; counts, if ever, through an aggregate
   that names no one.
3. **500 of each** per customer.
4. The heart is **hidden on a provider's own** listings and profile.
5. **Unsaved items stay greyed with "Undo"** on the Saved page for the rest
   of the visit.
6. **Unavailable names:** hidden when lokl took it down or the provider was
   suspended, kept when the provider unlisted it (above).

## As built (2026-10-04)

- `useSaved()` and `SaveButton` (website); the sign-in dialog and the
  page's live region are in `SaveSignInDialog`, mounted once in `app.vue`
  (browser only). Hearts forget the last person's saved items when someone
  signs out or another person signs in.
- Saving is an upsert that ignores a duplicate, and unsaving a plain delete:
  the one exception to the changed-row check (2026-10-04, decisions), since
  zero rows means it was already as wanted, and a refused save is an error.
- The Saved page loads through `GET /api/account/saved`: `my_saved()` as
  the customer, then the available items as a signed-out visitor sees them.
  Something that becomes hidden in between shows as no longer available.
- Removing an **unavailable** item on the Saved page shows "Removed" without
  Undo: it can't be saved again while it's unavailable.
- Taking down a provider's only live listing also makes their profile
  non-public, so a saved provider shows "No longer available" too, keeping
  their name (they weren't suspended).
- Also linked as **Saved** from the dashboard's menu for someone with no
  business yet, beside "My bookings".
- While a heart's change is still being sent, it carries `aria-busy="true"`
  (one sender per item, shared by every heart on the page). Found from a
  flaky CI run (37222934767, 2026-10-04): the test checked the database
  while a quick unsave-then-save was still being sent, saw the old row, and
  reloaded, which cut off the re-save. The test now waits for the heart to
  stop being busy, against an unsave made deliberately slow to arrive.
- **Leaving the page** with a heart still sending (tap, tap again, close the
  tab or follow a link off the site at once): on `pagehide`, each heart
  still sending or not yet sent sends what the person last asked for
  straight to the database, with `fetch(..., { keepalive: true })`, which the
  browser finishes after the page has gone (owner's request, 2026-10-04).
  Tested by tapping twice with the unsave's answer held back and leaving at
  once: the last tap is saved; without the flush it was lost. One case it
  can't order: an earlier change that's still on its way to the database
  when the page closes could arrive after the flush; the two requests leave
  in that order, so it's rare.
- End-to-end: `e2e/journeys/9-saved.spec.ts` (four tests). Deliberate
  breaks caught: no rollback on a failed save, the heart shown on a
  provider's own listing, the sign-in intent never cleared.

## Open questions (resolved: see Decisions)

1. **The heart's name:** keep "Save Sweet Auburn Food Walk" and show saved
   through the pressed state (recommended: the standard pattern, and screen
   readers announce "pressed"), or change the name to "Saved" once saved?
2. **Admins and saved items:** no access at all (recommended for now:
   private means private; a count for providers or the admin can come later
   through an aggregate function, without naming anyone), or let admins read
   them for support?
3. **The limit:** 500 per kind per customer (recommended), or none?
4. **Hiding the heart on a provider's own listings and profile:** hide it
   (recommended: saving your own listing is meaningless), or leave it?
5. **Undo on the Saved page:** keep unsaved cards greyed with "Undo" for the
   rest of the visit (recommended), or remove them at once?
