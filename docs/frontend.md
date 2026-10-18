# Frontend

Status: draft for Claude Code to check against the repo · 2026-09-27
How the website and admin app build their UI. Same approach as The Reserve, adapted to a monorepo with two apps.

## Stack

- **Nuxt 4** with TypeScript, in both apps.
- **Tailwind CSS v4.**
- **ui-thing** for all UI components (built on Reka UI). Components are copied into the repo by its CLI and owned by us.
- **Lucide** icons only. No Heroicons or other icon sets.
- **vee-validate + zod** for forms.
- **TanStack Table** for data tables.
- **Radio groups** (`UiRadioGroup`) select the radio an arrow key moves to straight away, like native radios (a lokl change: Reka selects only if the key is still held when its timer runs, so an instant press from voice control, a switch device or a script moved focus without selecting). It selects in the keydown itself, choosing the radio by Reka's rules (orientation, reading direction, looping, disabled radios), so it doesn't depend on timing (since 2026-10-11; waiting a tick for focus failed in CI). Reka's own late select is also stopped (2026-10-18): it clicks a radio a moment after focus reaches it if an arrow key is held then, and on a busy page those timers fired during a later press and selected radios focus had left, so the selection fell behind focus. A click made by code, while an arrow key is held, on a radio of the group that hasn't focus and wasn't just selected by the group, is stopped. E2e journey 2 recreates it (timers 40ms late, keys held 30ms).
- **Stars:** ui-thing's `UiRating` draws stars only: its stars can't be reached or chosen with the keyboard and have no names, so it's always hidden from screen readers with the rating in words beside it (`ReviewStars`). To choose stars, use `StarRatingInput` (ui-thing's radio group, one named radio per star).
- **Sonner**, through ui-thing's `UiSonner` (in each app's `app.vue`) and `useSonner`, for toasts. `useSonner` is the toast function itself, auto-imported by ui-thing: call `useSonner.success("Saved.")`, `useSonner.error(…)` or `useSonner("…")`, not `useSonner()`.

No other component libraries. If ui-thing has a component for something, use it rather than writing a new one.

## Where components live

ui-thing components live once, in a shared Nuxt layer at `packages/ui`, which both apps extend. That way the website and admin app share one set of components and one theme.

- `packages/ui/app/components/Ui/`: ui-thing components, auto-imported as `Ui…` (for example `UiButton`, `UiSelect`).
- `packages/ui/app/components/`: shared lokl components built from them, such as `StatusBadge` and `MoneyInput`.
- `packages/ui/app/assets/css/`: Tailwind entry and theme tokens.
- `apps/<app>/app/components/`: components used by only one app.

If the ui-thing CLI can't run inside the layer, install into each app instead and record the reason in `docs/decisions.md`. Don't mix the two approaches.

## Adding and changing components

1. Add with the CLI, from the folder where ui-thing is set up: `npx ui-thing@latest add <name>`.
2. Run `npx nuxt prepare` in each app and restart the TypeScript server, so the new component's types are picked up.
3. Commit the added files as they came from the CLI, before changing anything. The CLI reinstalls `yup` and `@vee-validate/yup` whenever it adds a vee-validate component; no component uses them, so remove them after each add (`npm uninstall yup @vee-validate/yup -w @repo/ui`). Forms use zod.
4. Check that the CLI didn't rewrite a file we already have. When a new component depends on an existing one, `add` can overwrite it and silently drop lokl's changes (it rewrote `Button.vue` and removed the touch sizes). `packages/ui/ui-thing.config.ts` sets `force: false` to prevent this, but still run `git diff --name-only -- packages/ui/app/components/Ui` after every add, and restore any changed existing file with `git checkout HEAD -- <file>`.
5. Replace any `~/` import in a new component with a relative path. In a layer, `~` points at the app extending it, so `~/components/Ui/…` isn't found (AlertDialog's Action and Cancel needed this).
6. Make lokl-specific changes in the component's variants (`tv()`), not with one-off classes at each call site. Leave a short comment at the top of the file saying what was changed and why, so a later re-add doesn't silently undo it.

Never hand-copy a component from the ui-thing website or another project.

## Theme

- All colours come from CSS variables defined once in `packages/ui` (background, foreground, primary, muted, border, destructive and so on). No hex or rgb values in components or pages.
- Neutral greys until lokl's brand is set. The brand should then be a change to the token file only.
- The hosts' orange (`bg-hosts`, #c93f14, white text `text-hosts-foreground` at 4.99:1; its buttons are `link-white` and its rules white; darker than the logo's orange, on which white text fails AA) marks what invites people to host: the homepage's host card and hosting section (2026-10-11).
- Backdrops behind dialogs, alert dialogs and sheets are `bg-overlay` (the `--overlay` token: black at 40%), never blurred. Any new overlay component uses the same token.
- Light mode only at launch. The tokens are structured so dark mode can be added later without touching components.
- Typography and spacing use Tailwind's scale; no arbitrary pixel values without a reason.
- The font is Roboto, served from our own site by `@nuxt/fonts` (configured in `packages/ui/nuxt.config.ts`, used through `--font-sans` in `tailwind.css`), so visitors' browsers never contact Google. No `<link>` to Google Fonts or other font CDNs. Only weights 400, 500 and 700 are loaded: use `font-normal`, `font-medium` and `font-bold`. Any other weight is drawn with the nearest loaded one (`font-semibold` draws as 700). `font-display: swap`, with system fonts (and a size-matched Arial fallback) until Roboto loads. To add a weight, add it in both places it's named: the config and this line. (Bricolage Grotesque, briefly the hosting section's heading font, was removed on 2026-10-12: Roboto everywhere.)
- Nothing from other sites loads with a page. The one exception is Google's sign-in script (`https://accounts.google.com/gsi/client`, website only), loaded when the sign-in dialog or `/login` is shown and a Google client is set, never with a page (2026-10-11; docs/design/sign-in-with-code.md, Google).

## Links

Every link, and every button that looks like one, uses one of five
classes (defined once, in `packages/ui/app/assets/css/tailwind.css`;
decided 2026-10-11), so links look the same everywhere:

| Class | Looks like | Height | For |
| --- | --- | --- | --- |
| `link-primary` | A black button, white text, fully rounded | 44px | The main thing to do in a section: "See all guides" on the homepage, "Browse Experiences" |
| `link-secondary` | White, a black border, fully rounded | 36px to look at, 44px to tap (an invisible 4px above and below) | Everything else that looks like a button: "Browse Services", "View [provider]'s profile", "See details" |
| `link-tertiary` | Like `link-secondary` with no border: just the text, a light grey background on hover | 36px to look at, 44px to tap | The header's menu (Experiences, Services), "Everything in Atlanta", the back links, and other quiet links that still look like buttons |
| `link-white` | White, black text, no border, fully rounded | 36px to look at, 44px to tap | Links on a coloured background: "Get started" and "Start hosting" on the hosts' orange (2026-10-12) |
| `link-text` | Plain text, underlined, `font-medium` | The line's | Links in a sentence or a list |

- Add spacing and placement classes beside them (`mt-6`, `self-start`),
  not new colours, sizes or radii. A new kind of link is a change to this
  table and the CSS, not a one-off.
- Use at most one `link-primary` in a section, so the main action is clear.
- They work on `<NuxtLink>`, `<a>` and `<button>` alike. A button that
  opens a dialog keeps `aria-haspopup="dialog"`.
- A `link-secondary` marked as the current page (`aria-current="page"`:
  the browse category pills, page numbers) is filled black, so the
  selection isn't shown by colour alone: it's announced as the current page.
- Not converted, on purpose: whole-card and whole-row links (listing and
  guide cards, booking rows), whose look is the card; menus with their own
  item style (the dashboard sidebar, shared with the admin app, the account
  dropdown's items); and the logo. Links that open in a sentence are
  `link-text`, including email and phone links.
- The header's Sign in and Account are icon buttons, not link styles: a
  person icon in a 44px light grey circle (`bg-muted`), no text, named
  "Sign in" or "Account" by `aria-label` (2026-10-11).
- Every website link uses them (converted 2026-10-11; the admin app's links
  move over as its pages are next changed). `UiButton` is for actions that
  aren't links: never give it `to` or `href`.

## Chips

- **Top rated** (`TopRatedChip`): the words "Top rated" with a decorative
  award icon, a white pill with dark text and a border, never colour alone.
  On a listing card it's drawn at the top left of the photo but sits inside
  the card's link right after the title, so it's part of what screen readers
  read for the card. The rule is `isTopRated` (docs/design/reviews.md).

## Carousels

`ScrollCarousel` (shared layer, 2026-10-12) is the one horizontal carousel:
a CSS grid track with `scroll-snap-type: x mandatory` and each card snapping
to its start, about 1.2 cards on phones, 3 on tablets and 5 on desktop.

- **Width:** on phones and tablets the track runs to both screen edges, with
  the page's 16px added back as padding and `scroll-padding-inline`, so the
  first card and snapping line up with the page; on desktop it stays within
  the content width. A 4px margin added and taken back on every side keeps
  focus rings from being clipped. The last card scrolls fully into view.
- **Not `scroll-snap-stop: always`**: every flick would stop at the next
  card, which on a phone means a dozen swipes to the end.
- **Previous and Next** scroll one page of visible cards, smoothly unless
  "reduce motion" is set; a quick second press goes a page on from where the
  first was heading. They're named for the carousel ("Scroll Services
  left"), point at the track (`aria-controls`), show at every width, and at
  the ends are `aria-disabled` (dimmed), not `disabled`, so they keep focus.
- **Every card stays reachable:** the cards are a list in a section named
  by its heading, nothing off screen is `aria-hidden`, and a card focused
  with Tab is scrolled into view.
- **"See all"** is the last card, linking to the browse page.
- **Lenis** (the page's smooth scrolling) would take a slightly diagonal
  trackpad swipe for page scrolling; the track has
  `data-lenis-prevent-horizontal`, so a mostly sideways gesture scrolls it.
- Used on the homepage: an Experiences and a Services carousel below "On
  lokl now", 10 listings each and "See all". Tested in e2e journey 24.
- Test listings to look at: `node scripts/seed-carousel-test.mjs --provider
  <slug>` adds 24 tagged listings to one of your test providers on the
  hosted test database; `--remove` takes them out (tested locally by
  `seed-carousel.test.mts`).

## Search bar

`SearchBar` (tablets and wider) and `SearchPhone` (phones) in the website's
header, sharing `useSearch()` and the panels `SearchWhere`, `SearchWhen` and
`SearchWhat` (docs/design/search.md).

- **Built on Reka's Navigation Menu**, adapted for a form: plain divs inside
  `<form role="search">`, opened by click or keyboard only, with one shared
  panel that resizes.
- **Choices are `search-pill` buttons** with `aria-pressed` and a check
  icon, not radios, so the panel's arrow keys aren't fought.
- **Dates are the market's**, via `quickDates()`, never the device's.
- **Results open on All** when no kind is chosen: a section per kind, the
  first 6 (`SEARCH_SECTION_SIZE`) and "See all"; a kind's view is paged.
- **Dates filter both kinds**, up to 31 days (`MAX_SEARCH_DAYS`): the
  calendar stops there, and a longer range is refused in plain words
  (`SEARCH_RANGE_TOO_LONG`).
- **The public header is sticky.** `scroll-padding-top` keeps focused
  elements visible below it. A new sticky element must do the same.

## Availability page

The provider's `/dashboard/availability` (docs/design/service-availability.md):
`AvailabilityWeekly`, `AvailabilityDates`, `AvailabilityTimeOff`,
`AvailabilitySettings` and `SlotPreview` (also in a Service's sidebar).

- **Times are TimeInput, in market time,** with the zone named once at the
  top ("All times are Atlanta time (ET)"). An end of 12:00 AM means
  midnight (stored as 24:00).
- **Intervals:** a day is an "Open on …" checkbox plus its sets of hours,
  with Add hours, Remove (named with the hours and day) and Copy to every
  day. The rules (`weeklyHoursSchema`, `dateHoursSchema`) say what's wrong
  in words: "Overlaps 9:00 AM – 12:00 PM.", "Ends before it starts."
- **Each section saves on its own,** in one step where it's several rows
  (`replace_weekly_hours`, `replace_date_hours`), and says so in a toast.
- **Fresh data never overwrites unsaved changes:** a form resets to what
  was saved only when it has none (`meta.dirty`).
- **An unticked day is simply closed:** its hours stay in the form
  (`keepValuesOnUnmount`), aren't checked or saved, and come back when it's
  ticked again. "Check the hours marked above" appears only for an error on
  a field that's on screen.
- **No raw validation messages:** every rule on the page says what to do in
  plain words, wrong types included (`availability-forms.test.mts` checks
  none of zod's own "Invalid input…" reach the page).
- **The preview says why it's empty** (no hours, no mode, not live, payouts
  not set up), each with where to fix it, and treats a not-yet-started
  fetch as loading, never as "No times".

## Scheduling panel

`ServiceScheduler` (docs/design/service-availability.md): a Service's
"Check availability" dialog, full screen on phones.

- **Days are buttons** named with the full date and the count ("Friday,
  October 16, 24 times"), `aria-pressed` for the chosen one, and days with
  none struck through and `aria-disabled`, never colour alone. Market days
  only (`todayIn`, `weekStartOf`).
- **Times are a radio group** named with the day and the zone ("Times on
  Friday, October 16, Atlanta time (ET)"), 44px each; a polite live region
  says the count when the day changes. It's a `grid` group: all four arrow
  keys move, since the times sit in rows and columns (other radio groups
  stay vertical: Up and Down).
- **States:** skeleton times while loading, "Times didn't load" with Try
  again, "No times this week" with "Next available", and a time taken
  meanwhile sends the customer back to the times ("That time was just
  taken. Pick another.").
- **A Service with no free time at all** shows "Not taking bookings yet" on
  its listing page, with no button, and on its card when browsing.
- **`?date=YYYY-MM-DD`** (from dated search results) starts the panel on
  that day and opens it at once for a signed-in customer.

## Forms

- Every form uses vee-validate with a zod schema, passed through the layer's `zodSchema()` adapter: `useForm({ validationSchema: zodSchema(schema) })`. The official `@vee-validate/zod` only supports zod 3, and vee-validate 4.15 can't take zod 4 schemas directly. Switch to the official adapter once one supports zod 4.
- Schemas that describe data a server route receives live in `packages/types`, so the page and the server route validate with the same schema. The server route always validates again; client validation is for the user, not for security.
- Every input has a visible label. Placeholders are examples, never the label.
- Errors appear next to the field, in words, and say how to fix the problem ("Enter a price above $0"), not just what's wrong.
- Submit buttons show a loading state and are disabled while submitting, so a double click can't send twice.
- Success and failure of an action are confirmed with a toast; errors that need the user to act stay on the page.
- **Checkboxes (`UiVeeCheckbox`):** a yes/no checkbox is `false` when unticked, never `undefined` (`uncheckedValue`, 2026-10-15; Reka sends true or false, and vee-validate stored undefined, which a boolean rule refused). A checkbox with a `value` belongs to a group and keeps vee-validate's group behaviour.

### Form controls (decided 2026-10-03)

Every form control in both apps is one of ui-thing's own components, never a native control or ui-thing's native-wrapping ones (`UiNativeSelect`, `vee-native-checkbox`). In forms, use the vee-validate version (`UiVee…`).

| Control | Use | Not |
| --- | --- | --- |
| Choosing one of a short list | The shared `SelectInput` (ui-thing's `UiSelect`, Reka Select), or `UiVeeSelect` in forms, which wraps it (a lokl change: ui-thing's own wraps the native select). Options are `{ value, label, group? }`; a `null` or `""` value ("None", "All") works, though Reka can't hold an empty value, because `SelectInput` swaps in a stand-in and back. | `UiNativeSelect`, `<select>` |
| Choosing from a list that can grow long (providers, listings, areas once there are many) | The shared `SearchSelect` (ui-thing's `UiAutocomplete`, Reka Combobox): type to narrow, arrows and Enter to choose | A long select |
| A date | The shared `DatePicker` (plain, `v-model`) or `DateInput` (in forms, with label, hint and error), built on Reka UI's own DatePicker: type the month, day and year, or open the calendar. ui-thing's date picker isn't used: it's built on v-calendar, a second component library that draws only in the browser and has weaker keyboard and screen-reader support (decided 2026-10-03). The value is `"YYYY-MM-DD"`, `""` when empty. Link the label with `labelledby` (the field is a group of parts). | `<input type="date">`, ui-thing's `datepicker` |
| A range of days (filters such as "bookings between") | The shared `DateRangePicker` (Reka DateRangePicker): one button showing the range, opening a calendar of two months (one on a phone), with "Clear dates". Holds `{ start, end }` as `"YYYY-MM-DD"`. Not two separate From and To fields, and not ui-thing's v-calendar date picker in range mode. | Two date fields |
| A time of day | The shared `TimeInput`, whose hour, minute and AM/PM parts are `UiSelect`s (below, Formatting) | `<input type="time">` |
| A number | `UiNumberField` / `UiVeeNumberField` (Reka NumberField), with `min`, `max` and `step` | `<input type="number">` |
| Money | The shared `MoneyInput` (`UiCurrencyInput`) | A number field |
| One of a few options, shown together | `UiRadioGroup` / `UiVeeRadioGroup` | `<input type="radio">` |
| Yes or no, or several of a list | `UiCheckbox` / `UiVeeCheckbox` | `<input type="checkbox">`, `vee-native-checkbox` |
| Text | `UiInput`, `UiTextarea` and their `UiVee…` versions (ui-thing's own, styling the native element) | A bare `<input>` or `<textarea>` |
| A file | A `UiButton` that opens a hidden `<input type="file">` (an exception, decided 2026-10-03): every file picker ends in the native input, ui-thing's `vee-file-input` only restyles it, and its `Dropfile` area can't be reached by keyboard. The button can, and says what it does ("Add photos"). | A visible native file input |

- **Forms that submit as a normal page request** (the public browse filters, a GET form): give `SelectInput`, `SearchSelect` or `DatePicker` a `name`, and a hidden field carries the value. The controls need JavaScript to open; the form still submits without it.
- **Exceptions:** the Editor.js writing area in the guide editor, including its photo block, which Editor.js draws as plain HTML outside Vue; and file pickers (above).
- Numbers: the number field's +/− buttons are skipped by Tab (arrow keys change the value), and an emptied field gives the form `undefined` or `NaN`, so schemas treat those as "not set" where the field is optional.
- Every control still needs a visible label linked to it, works with the keyboard alone, announces its state to screen readers, and fits a phone screen (popovers stay inside the viewport, and touch targets are at least 44 pixels on the website).

## Data and states

- **A database function's JSON is read with `rpcJson("name", data)`**, which checks it against its schema in `rpcShapes.ts` and types it; never `data as …`.
- Reads that access rules already protect go through the Supabase client. Privileged actions (anything the provider or admin can't write directly, like publishing or approving) go through a server route.
- **An update or delete sent straight to the database must confirm it changed a row.** Row rules and filters don't raise an error when they match nothing, so the request "works" and changes nothing. End the query with `.select("id")` and check it with `changedRows(result, "saved" | "deleted" | "changed")`; show `problemText(error, "…")`, which tells the person nothing changed and to refresh (`packages/ui/app/utils/changedRows.ts`). The exception is a write where nothing to change is fine, such as marking notifications read that another tab already marked; say why in a comment.
- Every list or data view has three designed states besides success: loading, empty and error. Empty states say what the thing is and what to do next ("You haven't created any Services yet. Create your first one to start getting booking requests.").
- Tables in the admin app use TanStack Table through ui-thing's table components (`UiTanStackTable`), never a hand-built `<table>`: sortable columns where useful, filters above the table, and a sticky header on long tables. Every table shows ui-thing's `Pagination` and the page count in its footer, 25 rows a page, with no rows-per-page choice (set once in `UiTanStackTable`; don't change them per page).
- **Tables that can grow large search, filter, sort and page on the server** (Bookings, Experiences, Services, Providers): a database function returns one page plus the total; `useServerTable()` keeps the search, filters, page and sort in the URL (Back, reload and bookmarks work; filters push a history entry, typing replaces it; any change but the page goes back to page 1) and cancels outdated requests; `ServerTable` shows it; `TableSearch` (right-aligned) waits 300ms after typing stops. Long pickers, such as providers, use `SearchSelect` with `search` (server-side). Short reference lists (cities, categories) stay client-side.
- **Data someone else can change stays current** (listings, their status, anything an admin or another tab can change). Use the shared `useLiveData()` (docs/design/notifications.md):
  - Refresh when the tab becomes visible again, at most every 15 seconds.
  - Where a notification exists for the change, refresh live when it arrives.
  - Never overwrite unsaved changes. A refresh updates the saved data; a form with unsaved changes keeps its values, and a sentence says what changed. If the change locks the page, the form goes read-only and tells the person to copy anything they want to keep.

## Formatting

- Money is stored in cents and shown with one shared helper (for example `formatMoney(cents)` → `$45.00`). Price inputs use one shared `MoneyInput` that converts to cents.
- Times of day use the shared `TimeInput` (hour, minutes and AM/PM dropdowns, each a `UiSelect`, holding `"HH:MM"`), never `<input type="time">`: a native time field stays empty until every part is filled, so "6:30" without AM or PM reads as no time at all. Schemas check `isTimeOfDay` so a half-chosen time says "Choose the hour, minutes and AM or PM."
- **Every date and time names its zone** (the time-zone guard, 2026-10-10):
  - Anything tied to a booking, listing or session is shown in its market's
    zone: `marketZone(city)` from `@repo/types`, then `formatDate`,
    `formatDateTime`, `formatSessionDate` or `formatSessionTime`, which all
    require the zone.
  - The admin's own record-keeping times (edited, published, logged,
    reported, joined) use the home zone, labelled: `formatHomeDateTime`
    ("Oct 3, 2026, 4:03 PM Atlanta time"), or `formatHomeDate` with
    "(Atlanta time)" in the column or sentence.
  - Calendar days (`YYYY-MM-DD`, not instants) are read and shown in UTC
    (`formatDateRange`). "Today" and "this month" come from `todayIn` and
    `monthStartIn` for a zone, never the device.
  - Never use `toISOString()` to get a calendar day, local getters such as
    `getHours()`, or `new Date(y, m, d)`: they follow the device's zone.
    `npm run check:dates` (CI) enforces it.
- Statuses (listing, payouts, provider) are shown with one shared `StatusBadge` that maps each status to a label and a style. Pages never write their own status labels.
- Listing and guide photos are always displayed with `<NuxtImg>` (Nuxt Image, set up in the shared layer), never a plain `<img>`, with `width` and `height` set so the page doesn't jump while they load. The layer's `image.provider` is `none` for now; choosing a provider later then resizes every photo in one place.

## Accessibility

Target WCAG 2.2 AA in both apps.

- Never use colour alone to carry meaning. Every status badge has text; every error has words.
- Links aren't underlined unless they're text links (`link-text`, underlined and `font-medium`); a global rule in `packages/ui/app/assets/css/tailwind.css` removes underlines from every other link (since 2026-10-11; before, no link was underlined). A link inside a sentence uses `link-text`, so it's told apart by its underline and weight, not colour alone; see Links.
- Icon-only buttons have an `aria-label`. Decorative icons are hidden from screen readers.
- Everything works with a keyboard, and focus is always visible. Dialogs and sheets trap and return focus (ui-thing's Reka components do this; don't break it with custom wrappers).
- Photos need alt text; the listing editor requires it.
- Touch targets are at least 44 by 44 pixels on the website.
- Page titles are unique and describe the page, since screen readers announce them on navigation.
- Check new pages with axe in the browser before calling them done. Automated tests can come later.

## Writing

Plain language on every screen, especially the website, where providers are small business owners and hosts, not developers.

- Short sentences, everyday words. "Get paid" rather than "Configure payout settings".
- Say what happens next on buttons: "Submit for review", not "Submit".
- No internal terms on screen: no "RLS", "Stripe Connect", "Express account" or status codes.

## Layout

- The website is mobile-first. Many providers will manage their listings from a phone.
- The admin app is desktop-first, with pages that still work on a tablet.
- Both dashboards need a mobile menu before launch (already in the launch prep list).
- **Smooth scrolling** (Lenis, website only) runs only when the visitor's
  device doesn't ask to reduce motion (2026-10-17); otherwise the browser
  scrolls as usual. Anything that animates follows the same setting.
- **Overlays don't animate with reduced motion** (2026-10-18): dialogs,
  sheets, menus, selects, tooltips and popovers open, close and slide
  without animation when the device asks (one rule in the shared
  stylesheet, `tailwind.css`, on `animate-in`/`animate-out` and the
  overlays' transitions). A new animated component uses those utilities
  or adds its own `motion-reduce:` classes. E2e journey 34.
- **Nothing from other sites the privacy policy doesn't name:** icons are
  bundled (Lucide, plus one each from line-md and ph; a new icon set means
  installing its `@iconify-json/<set>` package) and fonts self-hosted. E2e
  journey 33 fails on any request outside the app, lokl's Supabase
  project, Google's sign-in script (sign-in forms) and Google Analytics.
- **Breadcrumbs** use the shared `UiBreadcrumbs` (ui-thing's, changed for
  lokl, 2026-10-17): `:items="[{ label, link }, …, { label }]"`, the last
  item the current page. It renders a `<nav aria-label="Breadcrumb">` with
  an ordered list, plain `link-text` links (no border or background) at
  least 24px tall with a visible focus ring, the current page as text with
  `aria-current="page"`, and separators hidden from screen readers. Never
  hand-write one, and never style crumbs as buttons. E2e journey 36.
- **Help centre articles** (`apps/website/content/help/<customers|hosts>/<slug>.md`,
  2026-10-17): front matter `title`, `summary`, `order`, `updated`
  (YYYY-MM-DD); plain language, numbered steps, the screen's own words in
  bold. Never write a number the code decides: use `{{NAME}}` from
  `HELP_FACTS` (`@repo/types`, help.ts), adding the fact there from the
  code's constant. Link only to pages that exist. `npm run test:ui` checks
  it all; e2e journey 36 opens every article.
- **Google Analytics** (website only, 2026-10-17): send events only through
  `useAnalytics().send(...)`, built by a function in `@repo/types`
  (`analytics.ts`) that returns only allowed keys: fixed words, public ids,
  slugs, counts, prices. Never a name, email, phone number, booking id or
  anything typed. A new event adds its builder, its unit tests
  (`packages/ui/tests/analytics.test.mts`) and a check in e2e journey 35,
  and the privacy policy's analytics section. Never call nuxt-gtag's
  `useTrackEvent` or `gtag` directly: `useAnalytics` is the gate.
- **Both dashboards' frame stays put** (2026-10-17): the top bar is
  `sticky`, and the sidebar fills the screen (`sticky`, `h-dvh`) with the
  email and "Sign out" at its bottom; a long menu scrolls inside it. The
  page sets a top scroll padding (`scroll-pt-16`), so a jump to a heading
  stops below the bar. E2e journey 32.
- **The notification bell's panel** (`NotificationPanel`, shared by the
  provider's bell and the admin's) is a popover with a list of buttons, not
  a menu: Tab reaches every notification (a menu takes arrow keys, and Tab
  closes it). The list scrolls inside the panel, at most the smaller of
  70% of the screen and 480px, with `overscroll-behavior: contain` and
  `data-lenis-prevent`, so the page behind never scrolls; a focused
  notification is scrolled into view. E2e journey 31.

## Not allowed

- Other component or icon libraries.
- Native form controls, or ui-thing's native-wrapping ones, outside the Editor.js writing area (see Form controls).
- Hard-coded colours.
- Status labels, money formatting or date formatting written inline in a page.
- A plain `<img>` for listing or guide photos (use `<NuxtImg>`).
- Browser storage for anything that isn't a per-viewer convenience.
- Hand-copied components.

## Later

- A `lokl-frontend` skill, drafted from real pages once the listings screens exist, using The Reserve's frontend skill as a reference for what to include.
- Automated accessibility checks in CI.
- Dark mode, if wanted after the brand is set.
