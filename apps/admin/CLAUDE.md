# Admin — app rules

Owner-only dashboard. Port 3101 (fixed). Root `CLAUDE.md` applies too.

- **Client-rendered on purpose** (`ssr: false`) and blocked from search engines
  (`robots: noindex, nofollow`). Keep both.
- **Every page is admin-only.** The Supabase module sends signed-out users to
  `/login`; `app/middleware/admin.global.ts` asks the database
  (`admin_role()`) and sends anyone without a role to the second step, to
  set up an authenticator (a team member without one), or away. Both are
  for usability only; the database is the real gate.
- **Reads** can query Supabase from the page with `useSupabaseClient()`. RLS
  admin policies (`public.is_admin()`) decide what comes back, as in
  `app/pages/providers.vue`.
- **Writes, two kinds.**
  - *Admin-only reference lists* (cities, service areas, categories) are
    written from the page with `useSupabaseClient()`, under admin-only
    database rules (`public.is_admin()`).
  - *Status changes and anything that crosses users* (listing approval)
    go through a server route in `server/api/` that calls
    `requireAdmin(event)` first, then uses the service role. Anything that
    needs Stripe, or has money consequences (refunds, payouts, provider
    suspension), goes through the website's admin routes instead (below).
- **No Stripe keys in this app.** Anything that needs Stripe gets a website
  server route. The admin app never calls Stripe directly.
- **Calling the website's admin routes** (`/api/admin/*`: refunds,
  cancellations, payouts, provider suspension): use `useWebsiteAdmin()`,
  which sends the admin's own sign-in token as `Authorization: Bearer`. The
  website checks the token, the admin role (`admin_role()`) and that the call comes from this
  app's exact address (`NUXT_ADMIN_ORIGIN` there, `NUXT_PUBLIC_WEBSITE_URL`
  here; decision 14). Each action takes a reason (`ReasonDialog`) and is
  logged in `admin_actions`; a problem report's reply, move and note take
  none (the report's own tables are the record; decided 2026-10-17).
- **Its own session cookie** (`supabase.cookiePrefix` in `nuxt.config.ts`):
  on localhost the website and this app would otherwise share one session,
  since cookies ignore the port. Never set a cookie domain.
- **The second factor** (docs/design/admin-roles.md): `/security` sets up
  authenticators (an app; the key shown only while setting up) and
  `/security/verify` is the second step after the emailed code. Required
  since the admin roles migration (`ADMIN_MFA_REQUIRED` in `@repo/types`):
  the database refuses sessions that haven't passed it. `/security` is
  open to team members, invited or active (an invited member sets up
  before joining), and shows only their own authenticators; without a
  role it uses the plain `account` layout, with no admin navigation.
  Anyone else is turned away. The second step is open to anyone signed
  in. If the access check itself fails, `/access-check` says so and offers
  to try again. Authenticator apps
  list the entry as "lokl admin" (`AUTHENTICATOR_ISSUER`).
- **Server routes act for the admin's session:** `requireAdmin(event)`
  returns `db`, a server-key client carrying the session header
  (`serviceClientForAdmin`), for admin functions that take `p_admin_id`.
- **The login page never creates accounts** (`shouldCreateUser: false`). Team
  members are in `admin_members` (the Team page, step 5; until then, by
  hand, and break-glass in docs/design/admin-roles.md).
- **Page structure:** `PageHeader` and `EmptyState` from `app/components/`;
  everything else from the shared layer (`Ui…` components, `StatusBadge`).
  Colours come from the layer's tokens (`background`, `card`, `muted`,
  `foreground`, `muted-foreground`, `border`, `primary`, `destructive`); see
  `docs/frontend.md`.
- **Sidebar sections** are defined in `app/layouts/default.vue`. Add new pages there.
