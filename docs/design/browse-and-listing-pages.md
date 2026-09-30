# Public browse and listing pages

Status: approved design · 2026-09-30
Product build step 3. Covers the pages customers use to find and read about Services and Experiences. Booking and checkout are step 4 and get their own design doc; this step shows where the booking button will go but doesn't take bookings.

## Why

Providers can publish Services and have Experiences approved, but there's nowhere for customers to see them. These pages are also how search engines find lokl: each listing, category and city page should be worth indexing on its own.

## Decisions to make

Add to `docs/decisions.md` once approved.

| Decision | Recommendation | Why |
| --- | --- | --- |
| Where listings live | `/experiences/<slug>` and `/services/<slug>` | A listing's slug never changes, so its link never breaks, even if it later moves category. City and category show on the page and in breadcrumbs instead |
| Where browsing lives | By city: `/atlanta/experiences`, `/atlanta/experiences/<category>`, and the same for services | People search "food tours in Atlanta"; city in the path matches that, and a second city slots in without new URL patterns |
| `/experiences` and `/services` | Temporary redirects (302) to Atlanta's pages while Atlanta is the only active city; a city picker once there are two | The homepage already links there; temporary, so search engines don't treat Atlanta as the permanent home of these URLs |
| How public pages read data | A cookie-less, signed-out Supabase client on the server, for every public page | Every visitor, signed in or not, sees exactly what the public sees. A provider's own draft never appears at a public URL, and pages can be cached |
| Caching | Browse, category and city pages cached for 60 seconds, then refreshed in the background (`swr: 60`). Listing pages aren't cached | A listing taken down or unpublished disappears from its own page immediately. A browse card can linger for up to a minute, and clicking it gives the 404 |
| Provider name on listings | Show the business name ("Hosted by …"); nothing else about the provider | Customers want to know who they're booking with. The name is what providers chose to show; phone, email and address stay private |
| Image sizes | A card copy (600px wide) saved at upload next to the full photo (option D); everything behind `<NuxtImg>` so a provider can be added later | Cards load a small file without any image service; decided 2026-09-30 |

## Pages

All pages are server-rendered, indexable, plain language, and work at phone width first.

### Listing page: `/experiences/<slug>`, `/services/<slug>`

Shown only while the listing is visible (live, and its provider, category and city active). Anything else, including a draft, a listing taken down, or a wrong slug, is a 404 page: "We couldn't find that listing. It may have been taken down." with links to browse. Never a hint that a draft exists.

- **Photos:** the cover large, the rest in a row below. Tapping opens a full-screen viewer with the photo's description as its caption. Every photo uses its alt text.
- **Title, category, area:** e.g. "Food and drink · Old Fourth Ward, Atlanta". For an "I come to you" Service: "Comes to you in: Old Fourth Ward, Inman Park…" (its travel areas).
- **Price:** "$65 per person" (Experiences) or "$45" (Services), plus the length when set ("2 hours 30 minutes").
- **Description:** as written, line breaks kept.
- **Hosted by:** the business name.
- **Experiences: upcoming dates.** The next 10 sessions in Atlanta time ("Sat, Oct 24 · 10:00 AM – 12:30 PM"), then "More dates" to show the rest. Spots left arrive with bookings in step 4. With no upcoming sessions: "No dates are open right now. Check back soon."
- **Booking button:** "Booking opens soon" for now, disabled, with a sentence saying so. Step 4 replaces it.
- **Never shown:** the exact address (it appears only after booking, in step 4), and nothing about the provider beyond the name.
- **Breadcrumbs:** Atlanta › Experiences › Food and drink › Taco crawl.

### Browse pages: `/atlanta/experiences`, `/atlanta/services`

- A heading ("Experiences in Atlanta"), a one-sentence intro, and cards: cover photo, title, area, price, and for Experiences the next date ("Next: Sat, Oct 24").
- **Filters**, all as links or plain form controls that work without JavaScript and are reflected in the URL so a filtered page can be shared:
  - Category (also its own page, below).
  - Area (neighbourhood).
  - Experiences: date, with "This weekend", "Next 7 days", or a date. Only listings with a session in that range.
- **Order:** Experiences by their next session, soonest first, and those with no upcoming date last. Services newest first.
- **Pages of 24**, with numbered page links (`?page=2`) rather than endless scrolling, so the page is linkable and keyboard-friendly.
- **Empty states:** "There are no Experiences in Atlanta yet. New ones are added every week." With filters: "Nothing matches these filters." with a button to clear them.

### Category pages: `/atlanta/experiences/<category>`

The browse page with that category chosen, plus the category's own heading and description (from the admin Categories page), so it stands alone as a page worth indexing. An inactive category's page is a 404; an active one with no visible listings shows the empty state.

### City page: `/atlanta`

A short hub: "Things to do and book in Atlanta", with the first few Experiences, the first few Services, and links to each category that has listings.

### Homepage

Unchanged except that its Experiences and Services links go to Atlanta's pages, and its `/homes` link is removed (nothing is planned for homes).

## Data and access

Public pages read through server routes (`/api/public/...`) that use a signed-out client with no cookies, so RLS applies exactly as it does to a stranger. The existing rules already let signed-out visitors read visible listings, their photos, travel areas and future sessions, and active categories, cities and areas.

One gap: **provider names.** Signed-out visitors can't read `providers` at all today. This needs one small migration:

- `providers_read_public`: signed-out and signed-in visitors can read a provider that's active and has at least one visible listing.
- Column grants for `anon` and `authenticated`: `select (id, display_name)` only, so the policy can't expose anything else (Stripe fields, status, city, owner).

With tests: a visitor reads the name of a provider with a visible listing; not one with only drafts; not a suspended one; no other column; and the break-once check.

Queries stay simple joins through PostgREST, naming the `service_areas` relationship where needed (the listing's own area versus its travel areas).

## SEO

With `@nuxtjs/seo` (already installed):

- **Titles and descriptions:** "Taco crawl · Food and drink in Old Fourth Ward, Atlanta | lokl"; the description is the listing's first sentence or two.
- **Canonical URLs:** listing pages are canonical at their own URL. Filtered browse pages are canonical at the unfiltered page, except category pages, which are canonical at themselves.
- **Social previews:** the cover photo at 1200×630, and title and price.
- **Structured data:** listing pages describe the offer (price, currency, area). Experience sessions are listed as dated events. Breadcrumbs on every page.
- **Sitemap:** every visible listing, browse page and category page with listings, updated as listings go live or come down.
- **Not indexed:** filtered combinations beyond category (area, date, page 2+).

## Images

The listing and browse pages are the first real test of photo sizes. Photos are stored at up to 2,000px (about 300 to 600 KB as WebP), which is right for the full-screen viewer and far too big for a card.

Sizes needed: cards about 400px wide (800px on high-density screens), the listing page's main photo up to 1,200px, the viewer at the full 2,000px, and 1200×630 for social previews.

Options for the Nuxt Image provider (`image.provider` in the shared layer, `none` today):

| Option | How | Trade-offs |
| --- | --- | --- |
| A. Supabase image transformations | `@nuxt/image`'s `supabase` provider resizes on Supabase's CDN | Works whatever hosting is chosen. A paid-plan feature, billed by the number of images transformed; check current pricing |
| B. The hosting platform's image service | e.g. Vercel's or Netlify's image optimisation, if lokl is hosted there | Usually included up to a limit; ties image resizing to the host, which isn't chosen yet (launch prep) |
| C. Nuxt's own image server (IPX) | Resizes on lokl's own server | No extra service, but uses server CPU and needs caching in front of it |
| D. Make a small copy at upload | The browser already resizes before upload; it would also make an 800px card copy | No service at all and very cheap; one small migration (a second file per photo), and existing photos need a one-off backfill |

**Chosen (2026-09-30): D.** At upload, the browser also saves a card copy about 600px wide, as WebP, next to the full photo. Browse cards use the card copy; the listing page and viewer use the full photo. Everything stays behind `<NuxtImg>`, so a provider (A or B) can still be chosen later without touching the pages.

- A second file per photo, in the same folder: `<provider>/<listing>/<uuid>.card.webp`.
- A small migration adds `listing_photos.card_path` (optional, and checked to be the card copy of the same photo). Cards fall back to the full photo when it's missing. Existing test photos are re-uploaded rather than backfilled.
- Removing a photo, or deleting a draft, removes both files.

## Accessibility and writing

Per `docs/frontend.md`: plain language, never colour alone, 44px touch targets, visible focus, and a heading order that makes sense read aloud. Cards are single links with the title as their name. Dates and times are in the city's time zone with the zone named once per page ("Times are Atlanta time"). Prices always include "per person" where it applies.

## Tests

- pgTAP for the provider-name rule, as above.
- A check against the local stack that each public server route returns nothing for a draft, submitted, rejected or taken-down listing, or one whose provider, category or city is inactive, and returns a live one. This proves the pages can't leak what the database hides, and that the signed-out client is really signed out.
- Walkthrough on a phone-sized screen and with a keyboard.

## Build order

1. Migration: provider names (show before `db:push`).
2. Migration and upload change: card copies (show before `db:push`).
3. Public server routes and the signed-out client, with the leak check.
4. Listing page, with SEO and the 404.
5. Browse and category pages with filters and pagination.
6. City page, homepage links (remove `/homes`), redirects, sitemap.
7. `docs/decisions.md`, TODO.

## Out of scope

Booking (step 4); search by keyword; maps; provider profile pages; reviews; saved or favourite listings; a second city (the pages support it; adding one is admin work).

## Settled questions

Decided 2026-09-30.

- **Images:** option D, a card copy at upload (above).
- **`/homes`:** the link is removed from the homepage.
- **Provider profile pages:** later ("Later ideas" in `docs/TODO.md`).
- **Redirects:** temporary while Atlanta is the only city.
- **Clearing cached pages on takedown:** listing pages aren't cached, so they update immediately. Clearing cached browse pages the moment a listing comes down depends on where the site is hosted (its cache or CDN), so it's in launch prep in `docs/TODO.md`; until then they refresh within 60 seconds.
