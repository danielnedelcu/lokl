# TODO

Last updated: 2026-09-27. Update this when the board changes.

## Owner to-dos

These need Daniel, not Claude. The first five unblock testing what's built.

- [ ] **Link the Supabase project and apply the providers migration.** Run
      `npx supabase login` and `npx supabase link --project-ref <project id>`,
      then approve `npm run db:push`. Alternatively, paste the migration into
      the SQL Editor, but then the CLI's migration history won't know it ran.
- [ ] **Add `TBLS_DSN` to the root `.env`**: Supabase → Connect → Session
      pooler connection string. Needed for `db:docs`.
- [ ] **Update Supabase auth URLs for the new ports.** Authentication → URL
      Configuration: Site URL `http://localhost:3100`; redirect URLs
      `http://localhost:3100/confirm` and `http://localhost:3101/confirm`
      (remove the old 3000 and 3002 ones).
- [ ] **Make yourself admin.** Sign in once at `localhost:3101/login`, then in
      the SQL Editor: `update auth.users set raw_app_meta_data =
      raw_app_meta_data || '{"role":"admin"}' where email = '<your email>';`
- [ ] **Walk the provider flow.** Sign in at `localhost:3100/login`, create a
      profile, **Set up payouts**, use Stripe's test-mode prefill. Expect
      "Ready" on the payouts page and the provider on the admin Providers page.
- [ ] **Commit the work** once reviewed.
- [ ] **Pick a product name and domain**, needed for page titles (they show
      `%siteName` today), emails and Stripe branding.
- [ ] **Register the Stripe webhook** before launch: production
      `/api/stripe/webhook` under "Events on connected accounts",
      `account.updated`. Locally: `stripe listen --forward-connect-to
      localhost:3100/api/stripe/webhook`, and put the `whsec_…` value in
      `NUXT_STRIPE_WEBHOOK_SECRET`.
- [ ] **Talk to an accountant about marketplace sales tax** before live
      payments. Georgia's marketplace facilitator rules may apply, and rules
      differ in every market.

## Build order

Each step depends on the ones before it.

1. **Categories.** Admin creates and edits Service and Experience categories.
2. **Listings.** Providers create Services (details, service area, price) and
   Experiences (description, location, price). Photos in Supabase storage.
   Experiences queue for review; Services go live once payouts are ready.
3. **Public browse and listing pages.** Category pages, search by city, a page
   per listing, all indexable.
4. **Booking and checkout.** Stripe Checkout with the platform fee split
   automatically. Blocked on the commission decisions below.
5. **Booking management.** Provider and customer booking views, cancellations,
   refunds, payout history; admin Bookings & payouts page.
6. **Admin actions.** Suspend or reinstate providers, approve or reject
   Experiences, handle disputes, all via `requireAdmin` server routes.
7. **Destination guides.** AI draft (Anthropic API), editor with photo, slug and
   publish state, links into listings. Can start any time after step 3.
8. **Launch prep.** Hosting and domains, live Stripe keys, production webhook,
   email sender, generated types wired into both apps' `supabase.types`, and a
   mobile menu for both dashboards.

## Open decisions

| Decision | Options | Needed by |
| --- | --- | --- |
| Commission for Services | About 10–15% suggested | Step 4 |
| Commission for Experiences | About 20% suggested (industry 15–30%) | Step 4 |
| Who pays the commission | Provider absorbs, customer service fee, or split | Step 4 |
| How Services are booked | Fixed slots, request and confirm, or quote first | Step 2 |
| Cancellation and refund policy | Per provider, or one platform-wide policy | Step 5 |
| Several team members per business? | Members table later | Before multi-staff providers join |
| Product name, domain, brand | Not set | Launch |
| Sales contractor's commission | Flat bonus, revenue override, or hybrid; what counts as "signed" | Before outreach |
| How much admin to build before launch | Full now, or minimal + the Supabase table editor | Ongoing |

## Loose ends

- The signed-in flows (sign-in, profile, Stripe setup) have only been checked signed out.
- The website lists `h3` v2 (pre-release) as a dependency; remove it unless it's intentional.
- The machine runs Node 22.12; the repo's `engines` asks for 24 or later.
- Neither dashboard has a mobile menu yet.
- `packages/types/src/providers.ts` is hand-written; replace it with generated types after the first `db:types`.
- `packages/ui` is a React create-turbo leftover: delete it, or replace it with a Vue package.
