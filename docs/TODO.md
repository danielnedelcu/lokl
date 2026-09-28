# TODO

Last updated: 2026-09-27. Update this when the board changes.

## Move to lokl's own Supabase project

lokl is leaving the Supabase project it shared with the blog. Nothing from
the old project's dashboard carries over; redo each setting in the new one.

Status 2026-09-27: done. The new project has 1 admin, and the provider
walkthrough passed there. In the old project, the cleanup script removed
lokl's table, functions, migration row and admin role (verification query: all
four counts 0). Its SMTP is off, lokl's test logins and the old Resend key are
deleted, and the project is renamed.

- [x] **Create the project and update both apps' `.env` files**:
      `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_KEY`,
      `NUXT_SUPABASE_SECRET_KEY` in `apps/website/.env` and `apps/admin/.env`.
- [x] **Relink the CLI and push the schema.** `npx supabase link --project-ref
      <new project id>`, then approve `npm run db:push`, which runs `db:test`,
      the push, `db:types` and `db:docs`.
- [x] **Auth → URL Configuration.** Site URL `http://localhost:3100`; redirect
      URLs `http://localhost:3100/confirm` and `http://localhost:3101/confirm`.
- [x] **Auth → SMTP.** Custom SMTP through Resend: host `smtp.resend.com`,
      port 465, username `resend`, password = a Resend API key, sender
      `lokl@innatetheory.com` (until the lokl domain is set up).
- [x] **Auth → Rate Limits.** Match the old project's email and sign-in
      limits. The defaults are much lower until custom SMTP is on.
- [x] **Auth → Email Templates.** Copy over any templates you customised in
      the old project (magic link, confirm signup).
- [x] **Admin role.** Create your login by signing in once on the website
      (`localhost:3100/login`); the admin app never creates accounts. Then run
      the SQL in "Make yourself admin" below in the new project's SQL Editor,
      and sign in at `localhost:3101/login`.
- [x] **`TBLS_DSN`** in the root `.env`: the new project's Session pooler
      connection string.
- [x] **Re-run the provider walkthrough.** Logins and providers don't move, so
      sign up again. The old test providers' Stripe accounts in the Lokl
      sandbox are orphaned; delete them under Connect → Accounts if you like.
- [x] **Clean up the old project** with `scripts/cleanup-old-supabase-project.sql`,
      once the new one works. Replace `YOUR_EMAIL`, then run it in the OLD
      project's SQL Editor. It removes only lokl's table, functions, migration
      row and your admin role, and refuses to run anywhere without the blog's
      `posts` table.

## Owner to-dos

These need Daniel, not Claude.

- [x] **Link the Supabase project and apply the providers migration.** Run
      `npx supabase login` and `npx supabase link --project-ref <project id>`,
      then approve `npm run db:push`. Alternatively, paste the migration into
      the SQL Editor, but then the CLI's migration history won't know it ran.
- [ ] **Add `TBLS_DSN` to the root `.env`**: Supabase → Connect → Session
      pooler connection string. Needed for `db:docs`.
- [x] **Update Supabase auth URLs for the new ports.** Authentication → URL
      Configuration: Site URL `http://localhost:3100`; redirect URLs
      `http://localhost:3100/confirm` and `http://localhost:3101/confirm`
      (remove the old 3000 and 3002 ones).
- [x] **Make yourself admin.** Sign in once on the website
      (`localhost:3100/login`) to create your login, since the admin app never
      creates accounts. Then run this in the SQL Editor, with your email in
      `v_email`. It refuses a login that owns a business (see CLAUDE.md, Roles):

      ```sql
      do $$
      declare
        v_email constant text := '<admin email>';
        v_id uuid;
      begin
        select id into v_id from auth.users where email = v_email;
        if v_id is null then
          raise exception 'No login for %. Sign in once on the website first, then run this again.', v_email;
        end if;
        if exists (select 1 from public.providers where owner_id = v_id) then
          raise exception '% owns a business, so it can''t be made an admin. Use a login that owns no business, or move the business to another login first.', v_email;
        end if;
        update auth.users
           set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}'
         where id = v_id;
        raise notice '% is now an admin. Sign out and back in to pick up the role.', v_email;
      end;
      $$;
      ```
- [x] **Walk the provider flow.** Sign in at `localhost:3100/login`, create a
      profile, **Set up payouts**, use Stripe's test-mode prefill. Expect
      "Ready" on the payouts page and the provider on the admin Providers page.
- [x] **Commit the work** once reviewed.
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

## Walkthrough findings (2026-09-27)

The provider walkthrough passed: sign-in, business profile, Stripe onboarding,
and "Payouts are set up". These came up along the way.

- [x] **Stripe doesn't get the business name.** Onboarding doesn't prefill it
      from the provider's `display_name`, so the name in Stripe can differ
      from the lokl profile. Fixed: account creation now sends
      `business_profile.name`.
      Verify on the next test provider signup.
- [x] **City is free text** and accepted "Atanta". Decide during listings
      design; probably a fixed list of cities or service areas. Fixed in build
      step 1: providers pick from an admin-managed list of active cities.
- [x] **Apps fall back to port 3000 silently** when their port is taken.
      Make each app fail to start instead. Fixed: each app's `dev` script runs
      `scripts/check-port.mjs` first.
- [ ] **The webhook listener hasn't been tested locally.** Test it before launch.
- [ ] **Auth emails go through Resend from `lokl@innatetheory.com`.** Switch
      to the lokl domain before launch.

## Build order

Each step depends on the ones before it.

1. **Categories.** Admin creates and edits Service and Experience categories.
2. **Listings.** Providers create Services (details, service area, price) and
   Experiences (description, location, price). Photos in Supabase storage.
   Experiences queue for review; Services go live once payouts are ready.
3. **Public browse and listing pages.** Category pages, search by city, a page
   per listing, all indexable.
   - [ ] Decide image sizes and the Nuxt Image provider, including production hosting.
4. **Booking and checkout.** Stripe Checkout with the platform fee split
   automatically. Blocked on the commission decisions below.
   - [ ] Check that a listing's address matches its city and area (zip check,
     or geocoding).
5. **Booking management.** Provider and customer booking views, cancellations,
   refunds, payout history; admin Bookings & payouts page.
6. **Admin actions.** Suspend or reinstate providers, approve or reject
   Experiences, handle disputes, all via `requireAdmin` server routes.
   - [ ] Audit log for admin actions (who approved, rejected, unpublished or
     restored what).
7. **Destination guides.** AI draft (Anthropic API), editor with photo, slug and
   publish state, links into listings. Can start any time after step 3.
8. **Launch prep.** Hosting and domains, live Stripe keys, production webhook,
   email sender, generated types wired into both apps' `supabase.types`, and a
   mobile menu for both dashboards.

### What gets built next

Product steps 1 and 2 (categories and listings), from the approved design in
`docs/design/categories-and-listings.md`. Each step is one migration plus
tests, run through `db:test` before `db:push`.

1. ~~Cities and service areas, then the providers `city_id` change and the city picker.~~
   Done 2026-09-27 (`db3a133`); business profile walkthrough passed.
2. ~~Categories, plus the admin Categories and Cities pages.~~ Done 2026-09-27 (`3dc4ee6`).
3. ~~Listings, addresses and service areas, plus the provider Services and
   Experiences pages and the publish, submit and unlist routes.~~
   Done 2026-09-27 (`a4a624b`, `81658a0`, `0e13d4b`).
4. ~~Photos and the storage bucket, plus the photo section of the editor.~~
   Done 2026-09-27. The database refuses publish, submit and approve with no
   photos (tested); photos are resized and stripped of location data in the
   browser before upload (checked on a stored file). Photo walkthrough passed.
5. ~~Experience sessions, plus the Sessions section.~~ Done 2026-09-27.
   Times in the city's time zone; weekly series keep their local time
   across clock changes and save all or nothing. Walkthrough passed.
6. ~~Admin Listings page and review queue, with the approve, reject, unpublish
   and restore routes. Also: deactivating a category or city needs a
   confirmation that says how many live listings it will hide.~~
   Done 2026-09-27. Unpublishing needs a reason the provider sees; the
   dashboard overview flags listings that need attention. Walkthrough passed.

### Admin-login guard

- [x] ~~**Database guard: an admin login can't own a provider.**~~ Done
  2026-09-28 (`20260928032853_admin_owns_no_provider`): a trigger on
  `providers` refuses an admin owner. Making an existing owner an admin is
  checked by the admin-grant SQL above instead of a trigger on `auth.users`
  (docs/decisions.md). The test business moved from the admin login to
  `+provider2` on 2026-09-28, after the push.

## Notifications

- [ ] Provider in-app notifications and live updates: `docs/design/notifications.md`
  (approved 2026-09-27; build after step 6 is committed).
- [ ] Cleanup job: delete read notifications older than six months.
- [ ] Admin notifications, such as new Experiences waiting for review (also
  makes the review queue update live).
- [ ] Email providers when a listing is approved, rejected or unpublished.
  Until then, the dashboard overview shows "N listings need your attention"
  when any listing is rejected or unpublished.

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
| Stripe Accounts v2 | Stripe's SDK recommends Accounts v2 over the current `accounts.create({ type: "express" })` (v1), which still works | Later; before launch at the latest |

## Later ideas

- "Don't see your area? Tell us" link next to the area picker.

## Loose ends

- The website lists `h3` v2 (pre-release) as a dependency; remove it unless it's intentional.
- The machine runs Node 22.12; the repo's `engines` asks for 24 or later.
- Neither dashboard has a mobile menu yet.
- `packages/types/src/providers.ts` is hand-written; replace it with generated types after the first `db:types`.
