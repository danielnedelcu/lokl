# Header search

Status: built 2026-10-12 · e2e journey 26

A three-part search in the website's header: **Where**, **When**, **What**,
then a round Search button. It leads to a results page whose address holds
the filters. Plan approved 2026-10-12. The look follows Airbnb's large bar,
but narrower.

## The bar (tablets and wider)

- A `<form role="search" aria-label="Search lokl">`. It's a form, not site
  navigation, so there is no `<nav>` and no landmark beyond "search".
- **One shared panel.** Built on Reka's Navigation Menu (ui-thing's
  `UiNavigationMenu`), adapted for a form: `as="div"` throughout,
  `disable-hover-trigger` and `disable-pointer-leave-close`. Its viewport
  is one panel under the bar that stays open between segments and animates
  its size. With "reduce motion", the size doesn't animate and content
  doesn't slide.
- **Segments.** Each is a `<button type="button">` showing its label
  (`text-xs`, bold) and its value (`text-sm`), with `aria-expanded` and
  `aria-controls`.
  - A click or the keyboard opens one; hovering never does.
  - Escape closes it and returns focus to it.
  - A click outside closes it.
  - Tabbing from a panel on to the next segment closes the panel.
  - No grey on hover, focus or open.
- **Corners.** Square where segments meet: Where is round on the left only,
  When not at all, What on the right only.
- **Shadow.** The pill has one shadow, while it's hovered or one of its
  panels is open, so the active segment is always in view, keyboard users
  included. Segments and the Search button have none; the open panel has
  its own.
- **Auto-advance.** Choosing a Where opens When, and choosing a quick date
  opens What. Days picked in the calendar don't move on: one day is a choice
  on its own, shown in the bar at once, and a second day makes a range. Focus moves to that segment's
  button, so a screen reader announces it ("When, Any dates, expanded"),
  and Tab enters its panel. This is the owner's call.
- **Size.** The pill is at most 460px wide. The Search button (44px, the
  hosts' orange with a white icon, 4.99:1) sits just outside it, in the
  same form.
- **Placement.** In the header's row from 1024px wide; on its own row below
  the logo and menu on tablets.

### Where

A market's areas as pills in columns, sized to their text, with "Anywhere
in Atlanta" first. You choose one, like browse's area filter. With several
markets, each will be a column headed by its name.

### When

- **Quick dates** on the left: Today, Tomorrow and This weekend, each with
  its dates underneath.
- **A range calendar** (Reka's `RangeCalendar`, two months side by side) on
  the right. ui-thing's date pickers wrap v-calendar, so this follows
  `DateRangePicker` (decided 2026-10-03).
- **Atlanta's dates.** Every date is the market's ("Atlanta time"), never
  the device's: today, the quick dates and the earliest choosable day come
  from `quickDates(timeZone)`. Today is marked from that
  (`data-market-today`), not from Reka's `data-today`, which follows the
  device.
- **This weekend** is Saturday and Sunday, worked out in Atlanta:

| Today in Atlanta | This weekend |
| --- | --- |
| Monday to Friday | The coming Saturday and Sunday |
| Saturday | Today and Sunday |
| Sunday | Today only |

- **One day or a range.** The first day clicked shows in the bar at once
  and is searched as that day (`from` and `to` the same); a second day
  makes a range; a third starts again.
- **The note** under the calendar: "Dates are in Atlanta time (ET). Choose
  one day, or up to 31 in a row."

### What

Category pills for both kinds, under "Experiences" and "Services", with
"Anything" first. Only categories with live listings show. You choose one,
like browse's category filter. The segment is called "What", because
"Services" is one of the two kinds of listing.

### Pills

`search-pill` (in `tailwind.css`): a 44px pill button with `aria-pressed`.
A pressed pill is filled and shows a check icon, so the choice is never
shown by colour alone. The pills are buttons, not radios: the Navigation
Menu's panel moves focus with the arrow keys, which a radio group's own
arrow keys would fight.

## Phones

- One Search button in the header, named with what's chosen ("Search:
  Anywhere in Atlanta, Any dates, Anything").
- It opens a full-screen ui-thing Dialog. Focus stays inside, and Escape or
  Close returns focus to the button.
- Inside, the three segments are stacked as disclosure buttons, one open at
  a time, with the same panels and the same auto-advance.
- Clear all and Search are at the bottom. Search is the hosts' orange, like
  the bar's button: white text at 4.99:1. Both darken on hover, never
  lighten, which would lower the contrast.

## Dates and Services

Since 2026-10-15 (phase 4 of [service-availability.md](service-availability.md)),
dates filter both kinds: an Experience with a session on one of the days, a
Service with a free time on one of them, by the panel's own rules.

- Dated Services come soonest free time first, then by title; each card
  opens the Service's scheduling panel on its first free day searched
  (`?date=`).
- A Service with no hours never matches dates. Without dates, one with no
  free time in its window comes last, marked "Not taking bookings yet".
- A range is at most 31 days: the calendar stops there (Reka's
  `maximumDays`), the results page says "Choose up to 31 days." for a longer
  link, and the API refuses it with the same words.
- (Until 2026-10-15 dates filtered Experiences only, with notes saying so.)

## Results

**Address:** `/<market>/search?area=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&kind=<kind>&category=<slug>&page=N`.

- `readSearch` and `searchPath` (`@repo/types`) read and build it, in a
  fixed order.
- Malformed values are dropped, never an error.
- A category counts only with its kind, since slugs are unique only within
  a kind.
- One date alone is that day, and a range given backwards is put right.

**Data:** `/api/public/search` calls browse's own `browsePublicListings`,
so the filtering, paging, counts and visibility rules are browse's.

- It returns one page of the shown kind, plus the other kind's count for
  the switch.
- A category fixes the kind. Otherwise Experiences show first.
- It's cached for a minute, like browse.

**Page:**
- The heading, then each filter in use as a chip that removes just it.
- The kind switch, "Experiences (n)" and "Services (n)", made of links.
- The dates note when Services are shown with dates.
- Cards and pages, as on browse.

**Empty state:** "No Experiences match this search", with Where, When and
What as buttons that open that segment in the bar (or the phone panel),
plus "Clear all filters".

Results pages are `noindex, follow`, since they duplicate the browse pages.

## The sticky header

- The public layout's header is `sticky top-0`, with `py-6`.
- Its height goes into `--header-height` (a ResizeObserver).
- `html { scroll-padding-top: var(--header-height) }` keeps a focused
  element from ever being hidden under it (WCAG 2.4.11).

## Tests

**Unit tests:**
- `quick-dates.test.mts`, run with the device in Tokyo and in Los Angeles:
  late Friday in Atlanta, just after midnight on Saturday, Sunday, the
  clock-change weekend, and Dec 31.
- `search-address.test.mts`: the address, reading it back, malformed
  values.

**E2e journey 26:**
- Each segment by keyboard and its screen reader attributes.
- No hover; the shared panel resizing; Escape; a click outside.
- Auto-advance.
- Reduce motion.
- Atlanta's quick dates and today, with the browser in Los Angeles and in
  Auckland at 11:30 PM Friday Atlanta time.
- The results address, matching browse's results, the counts, Services
  with dates, and the empty state.
- The phone panel.
- The sticky header and focus.
