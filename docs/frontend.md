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
- Light mode only at launch. The tokens are structured so dark mode can be added later without touching components.
- Typography and spacing use Tailwind's scale; no arbitrary pixel values without a reason.
- The font is Roboto, served from our own site by `@nuxt/fonts` (configured in `packages/ui/nuxt.config.ts`, used through `--font-sans` in `tailwind.css`), so visitors' browsers never contact Google. No `<link>` to Google Fonts or other font CDNs. Only weights 400, 500 and 700 are loaded: use `font-normal`, `font-medium` and `font-bold`. Any other weight is drawn with the nearest loaded one (`font-semibold` draws as 700). `font-display: swap`, with system fonts (and a size-matched Arial fallback) until Roboto loads. To add a weight, add it in both places it's named: the config and this line.

## Forms

- Every form uses vee-validate with a zod schema, passed through the layer's `zodSchema()` adapter: `useForm({ validationSchema: zodSchema(schema) })`. The official `@vee-validate/zod` only supports zod 3, and vee-validate 4.15 can't take zod 4 schemas directly. Switch to the official adapter once one supports zod 4.
- Schemas that describe data a server route receives live in `packages/types`, so the page and the server route validate with the same schema. The server route always validates again; client validation is for the user, not for security.
- Every input has a visible label. Placeholders are examples, never the label.
- Errors appear next to the field, in words, and say how to fix the problem ("Enter a price above $0"), not just what's wrong.
- Submit buttons show a loading state and are disabled while submitting, so a double click can't send twice.
- Success and failure of an action are confirmed with a toast; errors that need the user to act stay on the page.

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
- Dates and times are shown in the listing's city time zone, using one shared helper. Never use `toISOString()` to get a calendar day, since it shifts to UTC and can land on the wrong date.
- Statuses (listing, payouts, provider) are shown with one shared `StatusBadge` that maps each status to a label and a style. Pages never write their own status labels.
- Listing and guide photos are always displayed with `<NuxtImg>` (Nuxt Image, set up in the shared layer), never a plain `<img>`, with `width` and `height` set so the page doesn't jump while they load. The layer's `image.provider` is `none` for now; choosing a provider later then resizes every photo in one place.

## Accessibility

Target WCAG 2.2 AA in both apps.

- Never use colour alone to carry meaning. Every status badge has text; every error has words.
- Links are never underlined (a global rule in `packages/ui/app/assets/css/tailwind.css` enforces it). A link inside a sentence is `font-medium` so it stands out by weight, not colour alone; a standalone link reads as one from its wording ("See all guides", "← My bookings").
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
