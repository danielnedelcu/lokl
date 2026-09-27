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
3. Commit the added files as they came from the CLI, before changing anything.
4. Make lokl-specific changes in the component's variants (`tv()`), not with one-off classes at each call site. Leave a short comment at the top of the file saying what was changed and why, so a later re-add doesn't silently undo it.

Never hand-copy a component from the ui-thing website or another project.

## Theme

- All colours come from CSS variables defined once in `packages/ui` (background, foreground, primary, muted, border, destructive and so on). No hex or rgb values in components or pages.
- Neutral greys until lokl's brand is set. The brand should then be a change to the token file only.
- Light mode only at launch. The tokens are structured so dark mode can be added later without touching components.
- Typography and spacing use Tailwind's scale; no arbitrary pixel values without a reason.

## Forms

- Every form uses vee-validate with a zod schema, passed through the layer's `zodSchema()` adapter: `useForm({ validationSchema: zodSchema(schema) })`. The official `@vee-validate/zod` only supports zod 3, and vee-validate 4.15 can't take zod 4 schemas directly. Switch to the official adapter once one supports zod 4.
- Schemas that describe data a server route receives live in `packages/types`, so the page and the server route validate with the same schema. The server route always validates again; client validation is for the user, not for security.
- Every input has a visible label. Placeholders are examples, never the label.
- Errors appear next to the field, in words, and say how to fix the problem ("Enter a price above $0"), not just what's wrong.
- Submit buttons show a loading state and are disabled while submitting, so a double click can't send twice.
- Success and failure of an action are confirmed with a toast; errors that need the user to act stay on the page.

## Data and states

- Reads that access rules already protect go through the Supabase client. Privileged actions (anything the provider or admin can't write directly, like publishing or approving) go through a server route.
- Every list or data view has three designed states besides success: loading, empty and error. Empty states say what the thing is and what to do next ("You haven't created any Services yet. Create your first one to start getting booking requests.").
- Tables in the admin app use TanStack Table through ui-thing's table components: sortable columns where useful, filters above the table, and a sticky header on long tables.

## Formatting

- Money is stored in cents and shown with one shared helper (for example `formatMoney(cents)` → `$45.00`). Price inputs use one shared `MoneyInput` that converts to cents.
- Dates and times are shown in the listing's city time zone, using one shared helper. Never use `toISOString()` to get a calendar day, since it shifts to UTC and can land on the wrong date.
- Statuses (listing, payouts, provider) are shown with one shared `StatusBadge` that maps each status to a label and a style. Pages never write their own status labels.

## Accessibility

Target WCAG 2.2 AA in both apps.

- Never use colour alone to carry meaning. Every status badge has text; every error has words.
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
- Hard-coded colours.
- Status labels, money formatting or date formatting written inline in a page.
- Browser storage for anything that isn't a per-viewer convenience.
- Hand-copied components.

## Later

- A `lokl-frontend` skill, drafted from real pages once the listings screens exist, using The Reserve's frontend skill as a reference for what to include.
- Automated accessibility checks in CI.
- Dark mode, if wanted after the brand is set.
