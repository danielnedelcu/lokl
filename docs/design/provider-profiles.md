# Provider profiles

Status: **built** (2026-10-04): approved with the recommendation on every
open question (see Decisions, at the end). The first of three planned
features, in order: provider profiles, favourites, reviews and star ratings
([docs/TODO.md](../TODO.md), Next features). This document covers profiles
only, and leaves room on the listing page for the other two.

## Why

A listing page today says "Hosted by Peach Tours" and nothing more about who
that is. People book local services and experiences from someone they can
picture and trust. A profile gives each provider a face, a line about what
they do, and a short story, and lets a customer find their other listings.

## What a profile has

| Part | Rules | Shown where |
| --- | --- | --- |
| **Business name** | exists today (`display_name`, 2–120 characters) | everywhere the provider appears |
| **Avatar** | a square photo or logo; shown round; optional (without one, the business name's initials on a neutral circle) | profile card, profile page, later next to reviews and replies |
| **Cover photo** | a wide photo, landscape, at least 1,600 × 600; optional (without one, a plain band in the theme's muted colour) | profile page only |
| **Headline** | one line, up to 80 characters, e.g. "Food walks through Atlanta's oldest neighborhoods" | profile card, profile page |
| **Bio** | plain text, up to 1,000 characters, in short paragraphs; no links, no formatting | profile page in full; the card shows its first two lines |
| **Based in** | the provider's market, which exists today (`city_id`): "Based in Atlanta" | card, page |
| **On lokl since** | month and year the provider joined, from `created_at`: "On lokl since October 2026" | card, page |

The business name, headline and bio are the provider's own words. The
settings page says, in plain language, what they're for and that they're
public.

## What's public, and what never is

The profile is public only while the provider can be booked: **active, with
at least one visible listing** (the rule signed-out visitors already read
providers by, `providers_read_public`). A suspended provider, or one with no
live listing, has no public profile; their profile page is a 404 and their
card isn't shown anywhere.

| Public (to signed-out visitors) | Never public |
| --- | --- |
| business name, headline, bio | the owner's name, email or sign-in |
| avatar and cover photo | Stripe account and payout status |
| market ("Based in Atlanta") | suspension and its reasons |
| month and year joined | any address (listing addresses stay private, as today) |
| their visible listings | phone or email (contact details reach a customer only once a booking is confirmed, as today) |

As today, the database enforces this: the public policy decides which
providers, and **column grants for `anon`** decide which columns (adding
`headline`, `bio`, `avatar_path`, `cover_path`, `created_at` to the existing
`id` and `display_name`). Signed-in users keep their current access; public
pages read through the signed-out server client, so customers see exactly
what visitors see.

**Contact details in the bio.** A bio with a phone number, email or web
address would take bookings off lokl and expose private information. The
settings page checks for them as the provider types, and saving refuses a
bio that contains one, with a plain sentence saying why ("Leave out phone
numbers, emails and links. Customers reach you through bookings."). *Open
question 2.*

## Photos

Handled like listing photos ([prepareListingPhoto.ts](../../packages/ui/app/utils/prepareListingPhoto.ts),
[listing_photos migration](../../supabase/migrations/20260927231004_listing_photos.sql)):

- **In the browser, before upload:** resized, re-encoded (WebP, JPEG where
  WebP isn't available), and stripped of location and other metadata.
  - Avatar: cropped to a square (centre crop, with a preview the provider
    confirms), 512 × 512, plus a 128 × 128 copy for small places.
  - Cover: landscape, at least 1,600 × 600, stored at up to 2,400 wide, plus
    a 600-wide card copy; shown cropped to a band (about 3:1 on large
    screens, taller on phones), so the provider sees the crop before saving.
- **Storage:** a new public bucket, `provider-photos`, with files under the
  provider's own folder: `<provider_id>/avatar-<uuid>.webp`,
  `<provider_id>/cover-<uuid>.webp`. Storage rules let a provider write and
  delete only their own folder; anyone can read (public profile photos).
  5 MB limit, JPEG, PNG or WebP.
- **Replacing or removing** a photo deletes the old files, as listing photos
  do. The paths are saved through the server route, which checks they're in
  the provider's own folder.
- **Alt text:** none asked for. The avatar sits next to the business name,
  and the cover is decoration, so both are marked decorative (`alt=""`);
  screen readers read the name and headline instead.

## On the listing page

```text
┌──────────────────────────────────────────────────┬──────────────────────┐
│ [photos]                                         │                      │
│                                                  │                      │
│ Category · Area                        ♡ (later) │  $50 per person      │
│ Listing title                                    │  [booking panel]     │
│ ★ rating line (later)                            │                      │
│                                                  │                      │
│ About                                            │                      │
│ …                                                │                      │
│                                                  │                      │
│ Upcoming dates / Where they come to you          │                      │
│                                                  │                      │
│ ┌ Hosted by ───────────────────────────────────┐ │                      │
│ │ (avatar) Peach Tours            ★ (later)    │ │                      │
│ │ Food walks through Atlanta's oldest…         │ │                      │
│ │ Based in Atlanta · On lokl since Oct 2026    │ │                      │
│ │ First two lines of the bio…                  │ │                      │
│ │ View profile →                               │ │                      │
│ └──────────────────────────────────────────────┘ │                      │
│                                                  │                      │
│ More from Peach Tours                See all (5) │                      │
│ [card] [card] [card]                             │                      │
└──────────────────────────────────────────────────┴──────────────────────┘
```

- **The profile card** ("Hosted by" for Experiences, "Offered by" for
  Services, as today) goes in the main column after the listing's own
  details, so the booking panel stays where it is. It replaces today's
  one-line "Hosted by" mention.
- **"More from this provider":** up to three of their other visible
  listings, Experiences and Services together, newest first, with the same
  cards as the browse pages. Hidden when there are none. "See all (n)" goes
  to the profile page (or, if there's no profile page, is left out).
- **Room for later**, built into the layout now, rendered only when the
  feature exists:
  - **The favourite heart**: top right of the title block, a 44-pixel
    button, so the title wraps short of it on phones. (On the photos'
    corner it would cover part of the photo and fight the gallery's
    controls.)
  - **The rating line**: directly under the title, the same text size as
    the category line: "★ 4.8 (12 reviews)", or "New on lokl" for a
    provider without reviews.
  - **The card's rating**: beside the business name in the profile card.
  - Neither shows a placeholder now: there are no reviews yet, and a
    "New on lokl" before reviews exist would be on every listing.
- **Listing cards** on the browse pages keep their layout now; the heart
  and rating are added to them in their own features.

## A public profile page (recommended)

`/providers/<slug>`: the cover photo, avatar, business name, headline,
"Based in · On lokl since", the bio in full, then their visible
Experiences and Services. Later: their rating and reviews, and a heart to
save the provider.

- **Why have one:** the "See all" link needs somewhere to go; a customer who
  liked one booking can find the rest; it's a page search engines can find
  for the business name.
- **The address:** a `slug` on providers, made from the business name like
  listing slugs (`peach-tours`, numbered if taken), fixed once the profile
  has been public, as listing and guide addresses are. *Open question 1.*
- **Search engines:** in the sitemap while public; canonical address; the
  page's title "Peach Tours in Atlanta | lokl"; structured data as a
  `LocalBusiness` with name and image only (no address or phone).
- **When it isn't public** (suspended, no live listing): 404, and it leaves
  the sitemap.

## Editing it: the provider's settings

The dashboard's **Business profile** page (`/dashboard/settings`) grows from
"business name and market" to the whole profile:

1. **Business name** and **market** (as today).
2. **Headline**, with a character count.
3. **About you** (the bio), with a character count, the contact-details
   check, and a line saying it's public.
4. **Profile photo** and **cover photo**, each with the large "Click to add a
   photo" area used for guide photos, a preview in its real shape (round
   avatar, cropped cover band), and Replace and Remove.
5. **"See your public profile"**, once the profile is public; until then, a
   sentence saying it appears once a listing is live.

Saving goes through the existing server route (`POST /api/provider`,
validated with zod): the name, market, headline and bio together, and the
photo paths after their upload. A suspended provider can still edit their
profile (it isn't public while they're suspended).

## The admin

- The admin's provider view shows the profile (photos, headline, bio).
- **Removing a photo or clearing a bio or headline** that breaks the rules,
  with a reason, logged in `admin_actions`, and an email to the provider
  saying what was removed and why. The rules are written down (what's
  allowed in a profile) and applied the same way to everyone, as the
  reviews rules will be. *Open question 3.*

## Building it

1. **Database and storage:** the new columns (`headline`, `bio`,
   `avatar_path`, `avatar_small_path`, `cover_path`, `cover_card_path`,
   `slug`), their checks, the `anon` column grants, the `provider-photos`
   bucket and its rules, the slug trigger. pgTAP: visitors read only the
   public columns of public providers (never Stripe fields or status);
   a provider writes only their own photos and profile; a suspended
   provider's profile isn't public.
2. **Settings:** the profile form, photo upload and crop, the bio check.
3. **Listing page:** the profile card and "More from this provider", with
   the layout room for the heart and rating.
4. **Profile page** (if agreed), sitemap and structured data.
5. **Admin:** the profile on the provider view, and removal with a reason.

End-to-end tests: a provider fills in their profile and uploads both
photos; a visitor sees the card and "More from" on a listing, and the
profile page; a suspended provider's profile page is a 404.

## Decisions (2026-10-04)

1. **The profile page is built now**, at `/providers/<slug>`.
2. **Contact details are refused** in the bio **and the headline**, when the
   provider types and when saving (the database refuses them too:
   `has_contact_details`). The admin's removal is the backup for anything
   that slips through.
3. **The profile rules are written down now**, and the admin can **remove
   content with a reason** in this feature (part 5).
4. **The avatar is centre-cropped** to a square, with a preview to confirm.
5. **"On lokl since"** is shown.

## Profile rules

What a profile may not contain. The admin removes content that breaks one,
names the rule in the provider's email, and applies them the same way to
everyone (`PROFILE_RULES` in packages/types; the database lists the same
keys):

| Key | Rule |
| --- | --- |
| `contact_details` | Phone numbers, email addresses or web addresses. Customers reach providers through bookings. |
| `private_information` | Anyone's private information: home addresses, other people's names or photos without their consent. |
| `abuse` | Abusive, hateful, harassing or sexually explicit content. |
| `impersonation` | Pretending to be another business or person, or claiming awards, licences or affiliations the business doesn't have. |
| `unsuitable_photo` | A photo that isn't of the business, its work or its people, or that's explicit, violent or misleading. |
| `not_yours` | Photos or text the provider doesn't have the right to use. |

## Later improvements

- **Changing the profile address on a rename.** Today the address is made
  from the business name once and stays fixed. Later: when a provider
  renames their business, offer a new address made from the new name, and
  keep a **permanent (301) redirect** from every old address, so links and
  search results never break.

## Open questions (resolved: see Decisions)

1. **Profile page:** build it now, at `/providers/<slug>`? (Recommended:
   yes. Without it, "See all" has nowhere to go.)
2. **Contact details in bios:** refuse them when saving (recommended), or
   only warn?
3. **Profile rules and removal:** write the rules now and give the admin
   "remove with a reason" in this feature (recommended), or start with the
   admin editing by hand?
4. **Avatar crop:** a centre crop with a preview (recommended, simple), or
   let the provider drag to choose the square?
5. **"On lokl since":** show it (recommended: it helps new and established
   providers alike), or leave it out?
