# Website — app rules

Public site plus the provider dashboard. Port 3100 (fixed). Root `CLAUDE.md` applies too.

- **What's public.** Only `/dashboard*` requires sign-in (`supabase.redirectOptions.include`).
  Every other page stays public. `/dashboard/**`, `/login` and `/confirm` are
  `robots: false` in `routeRules`; keep new signed-in pages under `/dashboard`.
- **Server routes start with a check** from `server/utils/provider.ts`:
  `requireUser` (any signed-in user), `requireProvider` (owns an active
  provider; also blocks suspended ones) or `getOwnProvider` (may be null).
- **Which Supabase client.** Reads and profile writes use `serverSupabaseClient`
  so RLS applies. Use `serverSupabaseServiceRole` only for columns users can't
  write (Stripe fields, status), and only after the check above.
- **Stripe** goes through `useStripe()` and `syncStripeAccount()` in
  `server/utils/stripe.ts`. The webhook (`server/api/stripe/webhook.post.ts`)
  verifies the signature on the raw body before doing anything.
- **Validate request bodies** with zod via `readValidatedBody`, as in
  `server/api/provider/index.post.ts`.
- **Don't import from `"h3"`** here (the v2 pre-release is in this app's
  dependencies). Use `ServerEvent` for event types.
- **Dashboard pages** use `definePageMeta({ layout: "dashboard" })` and read the
  provider through `useProvider()`, which shares the `"provider"` fetch key so
  every page sees the same record.
- **Homepage markup** lives in `app/pages/index.vue`; `app/app.vue` only holds
  the Lenis smooth-scroll setup and `<NuxtPage />`.
- **Provider-facing copy** is plain language: short sentences, no jargon. Never
  show state by colour alone; pair it with an icon or words.
