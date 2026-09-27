# Admin — app rules

Owner-only dashboard. Port 3101 (fixed). Root `CLAUDE.md` applies too.

- **Client-rendered on purpose** (`ssr: false`) and blocked from search engines
  (`robots: noindex, nofollow`). Keep both.
- **Every page is admin-only.** The Supabase module sends signed-out users to
  `/login`; `app/middleware/admin.global.ts` sends signed-in non-admins away.
  Both are for usability only; the database is the real gate.
- **Reads** can query Supabase from the page with `useSupabaseClient()`. RLS
  admin policies (`public.is_admin()`) decide what comes back, as in
  `app/pages/providers.vue`.
- **Writes** to anything users can't write themselves (provider status,
  approvals, refunds) go through a server route in `server/api/` that calls
  `requireAdmin(event)` first, then uses the service role.
- **No Stripe keys in this app.** Anything that needs Stripe gets a website
  server route. The admin app never calls Stripe directly.
- **The login page never creates accounts** (`shouldCreateUser: false`). Admins
  are added by hand in Supabase.
- **Page structure:** `PageHeader` and `EmptyState` from `app/components/`.
  Colour tokens (`surface`, `border`, `ink`, `ink-muted`, `accent`) are in
  `app/assets/css/main.css`; use them instead of raw colours.
- **Sidebar sections** are defined in `app/layouts/default.vue`. Add new pages there.
