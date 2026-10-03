# TODO

Last updated: 2026-10-03. Update this when the board changes.

lokl's domain is **hilokl.com** (docs/decisions.md). Finished work is in
"Done" at the bottom.

## Open now

- [ ] **Part 7 walkthrough, steps 7 to 11** (steps 1 to 6 passed
  2026-10-02; the rest wait for Resend's daily quota to reset). First run
  `npm run job -- send-emails` once to send anything held by the quota.
  As `+customer1` booking from `+provider1`:
  - [ ] 7. The provider cancels a booking with a reason: the customer gets
    "Cancelled … had to cancel", without the reason; the provider gets
    nothing.
  - [ ] 8. A no-show reported after the start: the customer gets "We got your
    report"; the provider gets "A customer reported a problem", without the
    note.
  - [ ] 9. `npm run job -- pay-out --booking <id> --as-of due` (paid with card
    4000 0000 0000 0077): the provider gets "Payout sent".
  - [ ] 10. A booking on a `+provider2` listing: the provider email goes to
    `+provider2`, not `+provider1`.
  - [ ] 11. The provider's cancellation subjects: as `+customer1`, cancel a
    booking 3+ days out (provider gets "Booking cancelled: {title} on {date},
    no payout"), and one inside 48 hours after the grace hour ("…, you'll
    still be paid"); as admin, refund and cancel one ("Cancelled by lokl: …,
    no payout"). The customer's subject stays "Cancelled: …", so the two no
    longer group together in Gmail.
- [ ] **A second "Cancelled" email.** Booking emails are sent once per booking
  and kind (`booking_emails_once`), so a booking cancelled twice gets one
  "Cancelled" email. The case: a customer cancels late (no refund), then lokl
  refunds them in full; they'd never be told about the refund. It can't happen
  yet: lokl has no way to refund an already cancelled booking (admin cancel
  refuses it). When that's added, give the refund its own email (e.g.
  `customer_late_cancel_refunded`) rather than reusing "Cancelled".
- [ ] **Browse beyond 1,000 listings.** Browse filters and sorts in the server
  over at most 1,000 visible listings per market and kind (`BROWSE_LIMIT` in
  `apps/website/server/utils/publicListings.ts`). Move it into a database
  function before a market gets near that.
- [ ] **Check a listing's address against its city and area** (zip check, or
  geocoding).
- [ ] **Audit log for listing reviews** (who approved, rejected, unpublished or
  restored what). Booking, email and provider actions are logged in
  `admin_actions` since 2026-10-03; listing reviews aren't yet.

## Build order

Each step depends on the ones before it.

1. [x] **Categories.** Admin creates and edits Service and Experience
   categories.
2. [x] **Listings.** Providers create Services and Experiences, with photos;
   Experiences queue for review; Services go live once payouts are ready.
3. [x] **Public browse and listing pages.** Category pages, search by city, a
   page per listing, all indexable. Card-sized photo copies since 2026-09-30.
4. [x] **Booking and checkout** (`docs/design/booking-and-checkout.md`).
   Commission: the provider absorbs it, 12% for Services and 20% for
   Experiences, editable by the admin (with history), and each booking keeps
   the rate it was made with.
   - [x] Part 1, database; part 2, checkout routes and payments webhook
     (2026-10-01).
   - [x] Part 3, booking forms, return pages and My bookings (2026-10-01).
   - [x] Part 4, provider accept and decline and the provider's bookings pages
     (2026-10-02; `booking_requests_answers`).
   - [x] Type errors: `npm run typecheck` on both apps must pass before
     committing (2026-10-02).
   - [x] Part 5, timed jobs and payouts, with holds for the admin
     (2026-10-02; `booking_payouts`).
   - [x] Part 6, cancellations, refunds and no-show reports, with the 1-hour
     grace period (2026-10-02; `booking_cancellations`).
   - [x] Part 7, booking emails (2026-10-02; `booking_emails`). Walkthrough
     steps 7 to 11 are under "Open now".
   - [x] Part 8, the admin side, and provider suspension with its emails
     (2026-10-03; `booking_admin`, `provider_account_emails`).
   - [x] Booking finances only the provider and lokl can read (2026-10-03;
     `booking_finances`, rehearsed first on a copy of the hosted data).
   - [x] A booking cancelled with a full refund keeps no payout hold
     (2026-10-03; `cancelled_bookings_hold_nothing`).
5. [x] **Booking management.** Covered by step 4 (parts 4, 6 and 8).
6. [x] **Admin actions.** Covered by step 4, part 8. Its leftover, the audit
   log for listing reviews, is under "Open now".
7. [ ] **Destination guides** (`docs/design/destination-guides.md`, reviewed
   2026-10-03). In parts: database, editor, AI draft, public pages, homepage.
   - [x] Part 1: database. Guides with draft and live copies (including
     the listings block), photos, versions, AI draft log, homepage
     features, `publish_guide()` and `unpublish_guide()`, the
     `guide-photos` bucket. Pushed 2026-10-03.
   - [x] Part 2: admin editor (no AI). Guides list and "New guide", the
     editor (Editor.js, autosave, web address check, listings block
     preview), photos with credits, publish and unpublish routes,
     versions with "Copy into draft", draft preview, shared `GuideBody`
     renderer. Built 2026-10-03.
   - [ ] Part 3: AI draft. Next.
   - [ ] Part 4: public pages. Part 5: homepage.
8. [ ] **Launch.** See "Staging site" and "Launch prep" below.

## Staging site

A real address before the live one: `staging.hilokl.com` (website) and
`admin-staging.hilokl.com` (admin), on the testing Supabase project and the
Lokl Stripe sandbox. Test there first what needs a real address:

- [ ] Hosting for both apps on those addresses, over HTTPS.
- [ ] Supabase auth URLs for staging: Site URL and the `/confirm` redirects
  on both addresses.
- [ ] Photo upload from an iPhone (any browser there uses Apple's engine):
  check the stored files are a JPEG or WebP photo plus a `.card.jpg` or
  `.card.webp` about 600px wide, with `card_path` set. Also one from Chrome,
  kept, to confirm its card copy is WebP. (Safari on a Mac was checked on
  2026-09-30: `.card.jpg`, 600px. Removing a photo deletes both files.)
- [ ] The Stripe webhooks, registered for staging: `/api/stripe/webhook`
  ("Events on connected accounts", `account.updated`) and
  `/api/stripe/webhook-payments`. (The connected-accounts listener hasn't
  been tested locally yet either.)
- [ ] The job scheduler (`pg_cron` + `pg_net` calling `/api/jobs/*`,
  including `send-emails`); until then jobs run with `npm run job`
  (docs/design/booking-and-checkout.md).
- [ ] The Nuxt Image provider (`image.provider` in the shared layer, `none`
  today): the host's image service, or Supabase image transformations
  (docs/design/browse-and-listing-pages.md, Images).
- [ ] The admin's calls to the website over HTTPS across the two addresses:
  `NUXT_ADMIN_ORIGIN=https://admin-staging.hilokl.com` on the website,
  `NUXT_PUBLIC_WEBSITE_URL=https://staging.hilokl.com` on the admin; rerun
  the admin request checks against it.

## Launch prep

On hilokl.com: the website at `https://hilokl.com`, the admin at
`https://admin.hilokl.com`.

- **Domain and hosting**
  - [ ] Hosting and DNS for `hilokl.com` and `admin.hilokl.com`.
  - [ ] `NUXT_PUBLIC_SITE_URL=https://hilokl.com`;
    `NUXT_ADMIN_ORIGIN=https://admin.hilokl.com` (website);
    `NUXT_PUBLIC_WEBSITE_URL=https://hilokl.com` (admin).
  - [ ] Supabase auth URLs: Site URL `https://hilokl.com`; redirect URLs
    `https://hilokl.com/confirm` and `https://admin.hilokl.com/confirm`.
- **Email**
  - [ ] A separate Resend account for lokl, so its quota can't block The
    Reserve's emails (they share a Resend team today, whose daily quota ran
    out during the part 7 walkthrough on 2026-10-02), on a paid plan.
  - [ ] Verify `hilokl.com` in Resend.
  - [ ] Send from `hello@hilokl.com`: sign-in emails (Supabase → Auth → SMTP
    sender) and booking emails (`NUXT_EMAIL_FROM`), instead of
    `lokl@innatetheory.com`.
  - [ ] Reply-to `help@hilokl.com`, forwarding to `hilokl.help@gmail.com`
    (`NUXT_EMAIL_REPLY_TO`, and `NUXT_PUBLIC_SUPPORT_EMAIL` on pages).
  - [ ] `NUXT_EMAIL_MODE=send` in production.
- **Anthropic**
  - [ ] Create a separate production Anthropic API key for the admin app
    (`NUXT_ANTHROPIC_API_KEY`), apart from the development one.
- **Stripe**
  - [ ] Live keys (see "Separate production environment" under Open
    decisions).
  - [ ] Production webhooks: `https://hilokl.com/api/stripe/webhook`
    ("Events on connected accounts", `account.updated`) and
    `https://hilokl.com/api/stripe/webhook-payments`.
  - [ ] Card statement descriptor `HILOKL.COM` (5 to 22 characters), with
    `LOKL` as the shortened descriptor; Connect payout statement descriptor
    `LOKL` (what providers see on bank statements). The sandbox's card
    setting couldn't be changed through the API, and isn't needed in test
    mode.
  - [ ] Business website `https://hilokl.com` in Stripe's public details.
- **Database and jobs**
  - [ ] Expose the `private` schema in the production project's API settings
    (service role only: the migration revokes it from everyone else).
  - [ ] Turn on the job scheduler, including `send-emails`.
- **Site**
  - [ ] On `hilokl.com`, check `robots.txt` allows crawling and points to
    `/sitemap.xml`, and that the sitemap lists only public pages. (In
    development the SEO module sends `Disallow: /` on purpose.)
  - [ ] Replace the Nuxt favicon in both apps (`apps/website/public/favicon.ico`,
    `apps/admin/public/favicon.ico`) with lokl's, once there's a logo.
  - [ ] Clear cached browse pages as soon as a listing is taken down or
    unpublished (depends on the host's cache or CDN). Until then they refresh
    within 60 seconds; listing pages aren't cached.
  - [ ] UX polish pass across the public pages: font sizes, spacing and
    visual design.
- **Blockers for live payments** (sandbox testing can go ahead)
  - [ ] Accountant consultation on Georgia marketplace sales tax, commission
    taxability, holding provider funds, 1099-K and business setup.
  - [ ] Customer terms, provider terms (including Stripe's Connected Account
    Agreement), privacy policy and cancellation policy page, drafted then
    reviewed by a marketplace lawyer.

## Notifications

- [ ] Booking reminder emails the day before, to customer and provider
  (docs/design/booking-and-checkout.md, answer 8).
- [ ] Manual check on the hosted project: leave a provider tab in the
  background for 75 minutes, then take a listing down; the bell updates.
- [ ] Cleanup job: delete read notifications older than six months.
- [ ] Admin notifications, such as new Experiences waiting for review (also
  makes the review queue update live).
- [ ] Email providers when a listing is approved, rejected or unpublished.
  Until then, the dashboard overview shows "N listings need your attention"
  when any listing is rejected or unpublished.

## Open decisions

| Decision | Options | Needed by |
| --- | --- | --- |
| Separate production environment | Its own Supabase project and live Stripe account, apart from the testing ones | Before launch |
| Several team members per business? | Members table later | Before multi-staff providers join |
| Brand (logo, colours) | Not set (name: lokl; domain: hilokl.com) | Launch |
| Sales contractor's commission | Flat bonus, revenue override, or hybrid; what counts as "signed" | Before outreach |
| How much admin to build before launch | Full now, or minimal + the Supabase table editor | Ongoing |
| Stripe Accounts v2 | Stripe's SDK recommends Accounts v2 over the current `accounts.create({ type: "express" })` (v1), which still works | Later; before launch at the latest |

## Later ideas

- "Don't see your area? Tell us" link next to the area picker.
- Provider profile pages ("More from this host").
- Area pages such as `/atlanta/decatur`, once areas have enough listings to stand as pages (docs/design/browse-and-listing-pages.md).
- Optional note to the customer when declining a request (stored on the booking, sent in the decline email).
- Track provider cancellations and show patterns to the admin.
- Partial refunds (for example half, for a partly missed booking). Needs its own payout maths.
- Option to cancel and still pay the provider, when the cancellation isn't their fault.
- Deduct money owed from a provider's future payouts (a reversal that failed after a payout).
- A narrower provider view of `booking_finances`: providers can read their bookings' Stripe ids, though no page shows them (docs/design/booking-and-checkout.md).

## Loose ends

- The machine runs Node 22.12; the repo's `engines` asks for 24 or later. `.nvmrc` now says 24, so `nvm use` picks the right version.
- `packages/types/src/providers.ts` is hand-written; replace it with the generated types (`database.ts`) when it's next touched.

## Done

<details>
<summary>Earlier work, kept for reference</summary>

### Move to lokl's own Supabase project (2026-09-27)

lokl left the Supabase project it shared with the blog. The new project has 1
admin, and the provider walkthrough passed there. In the old project, the
cleanup script removed lokl's table, functions, migration row and admin role;
its SMTP is off, lokl's test logins and the old Resend key are deleted, and the
project is renamed. Done: the new project and both apps' `.env` files; the CLI
relinked and the schema pushed; auth URLs, SMTP through Resend, rate limits
and email templates; the admin role; `TBLS_DSN` in the root `.env`; the
provider walkthrough rerun; the old project cleaned up
(`scripts/cleanup-old-supabase-project.sql`).

### Owner to-dos

- [x] Link the Supabase project and apply the providers migration.
- [x] `TBLS_DSN` in the root `.env` (Session pooler connection string), for
  `db:docs`.
- [x] Supabase auth URLs for ports 3100 and 3101.
- [x] Make yourself admin: the SQL is in CLAUDE.md ("Granting admin").
- [x] Walk the provider flow; commit the work once reviewed.
- [x] Product name and domain: lokl, at hilokl.com (2026-10-03). The brand is
  under "Open decisions".

### Walkthrough findings (2026-09-27)

- [x] Stripe gets the business name (`business_profile.name`).
- [x] Cities are an admin-managed list, not free text.
- [x] Apps refuse to start on a taken port (`scripts/check-port.mjs`).
- [x] The webhook listener and the auth email sender moved to "Staging site"
  and "Launch prep".

### Product steps 1 and 2 (categories and listings)

From `docs/design/categories-and-listings.md`, each one migration plus tests:
cities and service areas (`db3a133`); categories and the admin Categories and
Cities pages (`3dc4ee6`); listings, addresses and service areas
(`a4a624b`, `81658a0`, `0e13d4b`); photos and the storage bucket; Experience
sessions; the admin Listings page and review queue. All 2026-09-27, each
walkthrough passed.

### Also done

- [x] An admin login can't own a provider (2026-09-28,
  `20260928032853_admin_owns_no_provider`; docs/decisions.md).
- [x] Provider in-app notifications and live updates
  (`docs/design/notifications.md`, 2026-09-28).
- [x] The homepage is lokl's own markup, with nothing loaded from other
  sites (2026-09-30).
- [x] The dashboards' phone menu (2026-09-30).
- [x] Generated types wired into both apps' `supabase.types` (2026-10-02).
- [x] The website's unused `h3` v2 removed (2026-10-02).
- [x] Settled decisions: Services are request and confirm; one platform-wide
  cancellation policy (docs/decisions.md).

</details>
