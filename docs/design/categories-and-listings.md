# Categories and listings

Status: approved design, ready to build · 2026-09-27
Covers build steps 1 (categories) and 2 (listings). Bookings, checkout and public browse pages are out of scope and get their own design docs.

## Decisions

Add these to `docs/decisions.md`, dated 2026-09-27.

| Decision                                                                                                       | Why                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Services are booked by request and confirm, with one fixed price per listing                                   | Fastest path to real bookings; providers don't have to keep a calendar on lokl. Time slots can be added later. |
| At checkout (step 4), a Service request places a hold on the card; it's charged only when the provider accepts | No charge for declined requests, so no refund work                                                             |
| Unanswered Service requests expire after 48 hours and the hold is released                                     | Keeps customers from waiting indefinitely; well inside Stripe's hold window                                    |
| Experiences are booked into scheduled sessions with a capacity, paid immediately                               | A spot either exists or doesn't, so there's nothing to confirm                                                 |
| Categories are flat, admin-managed, separate for Services and Experiences, one per listing                     | Enough structure for launch; subcategories can come later                                                      |
| Cities are an admin-managed list, not free text; launch with Atlanta only                                      | Fixes the "Atanta" walkthrough finding and makes search by city reliable                                       |
| Services happen either at the provider's location or at the customer's, within listed service areas            | Covers salons and studios as well as mobile services                                                           |
| Exact addresses are private until booking; listings show an area only                                          | Many providers work from home                                                                                  |
| Services have one price; Experiences are priced per person; all amounts in cents                               | Matches how each is sold; cents avoid rounding errors                                                          |
| Up to 8 photos per listing, first is the cover, at least one required to publish                               | Listings without photos don't sell                                                                             |
| Services go live once the provider's payouts are Ready; Experiences need owner review                          | Services are lower risk; Experiences are the brand-defining inventory                                          |
| One `listings` table for both kinds, with kind-specific rules as check constraints                             | Browse, search, photos and review work the same way for both                                                   |

## Tables

All new tables follow the migrations skill: `<table>_<action>` policy names, `comment on` for every table, column and policy, delete behaviour stated explicitly, and pgTAP tests covering allowed and blocked cases for every access rule.

### cities

The markets lokl operates in. A market is a metro area named after its main city: Atlanta covers the whole metro, and the cities and towns around it (Decatur, Marietta…) are areas inside it (see service_areas). Admin-managed. [Clarified 2026-09-30: the table keeps the name `cities`.]

| Column       | Notes                                                      |
| ------------ | ---------------------------------------------------------- |
| `id`         | uuid                                                       |
| `slug`       | unique, e.g. `atlanta`                                     |
| `name`       | e.g. `Atlanta`                                             |
| `state`      | two-letter code                                            |
| `timezone`   | IANA name, e.g. `America/New_York`; used for session times |
| `active`     | inactive cities are hidden everywhere public               |
| `sort_order` |                                                            |

Delete: never. Deactivate instead, since providers and listings point here.
Seed: Atlanta, active.

### service_areas

Areas within a market: neighbourhoods, cities or towns, and zip codes. Used by "I come to you" Services and as the public location label on listings. [`city` kind added 2026-09-30, for places like Decatur inside the Atlanta market.]

| Column       | Notes                             |
| ------------ | --------------------------------- |
| `id`         | uuid                              |
| `city_id`    | references cities, restrict       |
| `kind`       | `neighborhood`, `city` or `zip`   |
| `name`       | e.g. `Old Fourth Ward`, `Decatur` or `30312` |
| `active`     |                                   |
| `sort_order` |                                   |

Unique on `(city_id, kind, name)`. Delete: never; deactivate.
Seed: leave empty. The owner adds Atlanta's areas in admin.

### providers (change)

Replace the free-text `city` column with `city_id` referencing cities (restrict). The migration adds the column, backfills every existing provider to Atlanta, makes it required, then drops `city`. This is a new migration, since the providers migration is already applied. The business profile form becomes a city picker showing active cities.

A trigger requires the city to be active, but only on insert or when `city_id` changes, so a provider whose city is deactivated later can still edit their other fields. The foreign key alone would accept an inactive city, because it ignores access rules. [Added 2026-09-27, while building step 1.]

### categories

| Column        | Notes                                                        |
| ------------- | ------------------------------------------------------------ |
| `id`          | uuid                                                         |
| `kind`        | `service` or `experience`                                    |
| `name`        | 2 to 60 characters                                           |
| `slug`        | unique per kind                                              |
| `description` | optional, shown on category pages later                      |
| `active`      | inactive categories hide their listings from the public site |
| `sort_order`  |                                                              |

Unique on `(id, kind)` as well, so listings can reference both together (see below). Delete: never; deactivate.

### listings

One row per Service or Experience.

| Column                                        | Notes                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                          | uuid                                                                                                                                 |
| `provider_id`                                 | references providers, restrict                                                                                                       |
| `kind`                                        | `service` or `experience`; can't change after creation                                                                               |
| `category_id`                                 | composite reference `(category_id, kind)` to categories `(id, kind)`, so a Service can only use a Service category                   |
| `city_id`                                     | references cities, restrict                                                                                                          |
| `title`                                       | 5 to 100 characters                                                                                                                  |
| `slug`                                        | unique, generated from the title with a short suffix; used by public pages in step 3                                                 |
| `description`                                 | 20 to 5,000 characters                                                                                                               |
| `price_cents`                                 | integer, greater than 0; the whole price for a Service, per person for an Experience                                                 |
| `currency`                                    | `usd` for now                                                                                                                        |
| `duration_minutes`                            | required for Experiences; optional for Services                                                                                      |
| `location_mode`                               | Services only: `provider_location` or `customer_location`; must be null for Experiences                                              |
| `area_id`                                     | references service_areas; the public location label ("Old Fourth Ward"). Required for provider-location Services and for Experiences |
| `status`                                      | see Listing states                                                                                                                   |
| `rejection_reason`                            | set when an Experience is rejected; cleared on resubmission                                                                          |
| `submitted_at`, `reviewed_at`, `published_at` | timestamps; `published_at` is set the first time a listing goes live and never cleared                                               |
| `created_at`, `updated_at`                    | `updated_at` set by trigger                                                                                                          |

Check constraints enforce the kind-specific rules: Experiences have a duration and no location mode; Services have a location mode; provider-location Services and Experiences have an area.

`city_id` and `area_id` use the same pattern as `providers.city_id`: a trigger requires an active city and an active area, only on insert or when the column changes, so a listing whose city or area is deactivated later can still be edited. [Added 2026-09-27.]

Delete: a provider can delete their own listing only while it has never been live (`published_at` is null). After that, it's unlisted or unpublished, never deleted, because bookings will point at it.

### listing_addresses

The exact address, kept out of `listings` because access rules work per row, not per column. If the address lived on the listing, anyone who can see the listing could read it.

| Column                                           | Notes                                      |
| ------------------------------------------------ | ------------------------------------------ |
| `listing_id`                                     | primary key, references listings, cascade  |
| `line1`, `line2`, `city`, `state`, `postal_code` |                                            |
| `instructions`                                   | optional, e.g. "Side entrance, ring twice" |

Required for provider-location Services and Experiences before publishing or submitting.
Readable by the listing's provider and the admin. In the bookings step, a policy will let customers with a confirmed booking read it.

### listing_service_areas

Where an "I come to you" Service travels. Join table of `(listing_id, service_area_id)`. At least one row is required before a customer-location Service can go live. Rows cascade with the listing.

### listing_photos

| Column         | Notes                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| `id`           | uuid                                                                       |
| `listing_id`   | references listings, cascade                                               |
| `storage_path` | path in the `listing-photos` bucket                                        |
| `position`     | 0 to 7; 0 is the cover; unique per listing                                 |
| `alt_text`     | required, 5 to 200 characters; describes the photo for screen reader users |

A trigger rejects a ninth photo. Deleting a row doesn't delete the stored file; a cleanup job for orphaned files can come later.

### experience_sessions

| Column                     | Notes                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `id`                       | uuid                                                                  |
| `listing_id`               | references listings (Experiences only, enforced by trigger), cascade  |
| `starts_at`                | timestamptz; entered and displayed in the city's time zone            |
| `capacity`                 | 1 to 500                                                              |
| `status`                   | `scheduled` or `cancelled`                                            |
| `created_at`, `updated_at` |                                                                       |

Spots left will be computed from bookings in step 4. Sessions are cancelled, never deleted, once any booking exists. Before bookings exist, a provider can delete a future session.

`listing_id` cascades rather than restricts. [Changed 2026-09-27.] A listing can only be deleted while it has never been live, so none of its sessions can have bookings, and a deleted draft's sessions should go with it. Bookings will protect sessions with their own `restrict` reference, so a session with bookings still can't be deleted, whether directly or through its listing.

## Photo storage

Bucket `listing-photos`, public read, 5 MB limit, JPEG, PNG or WebP only.
Path: `<provider_id>/<listing_id>/<random uuid>.<ext>`. Paths are unguessable, so public read doesn't expose drafts in practice.
Storage policies: a provider can upload to and delete from only their own `<provider_id>/` folder. The admin can delete anything. Uploads go straight from the browser to storage; the listing_photos row is written after the upload succeeds.

## Listing states

| Status        | Meaning                                      | Visible to the public                              |
| ------------- | -------------------------------------------- | -------------------------------------------------- |
| `draft`       | Being written, or taken down by the provider | No                                                 |
| `submitted`   | Experience waiting for owner review          | No                                                 |
| `live`        | Bookable                                     | Yes, if provider, category and city are all active |
| `rejected`    | Experience sent back with a reason           | No                                                 |
| `unpublished` | Taken down by the owner                      | No                                                 |

Transitions, all through server routes. The `status` column and review fields are server-only, the same pattern as `providers.status`, so no one can publish or approve their own listing by writing to the table.

| Action            | Who      | From → to                     | Conditions                                                                                                                                   |
| ----------------- | -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish Service   | provider | draft → live                  | Payouts Ready (`stripe_charges_enabled` and `stripe_payouts_enabled`), at least one photo, address or service areas present, provider active |
| Submit Experience | provider | draft or rejected → submitted | At least one photo, address present, provider active                                                                                         |
| Unlist            | provider | live or submitted → draft     |                                                                                                                                              |
| Approve           | admin    | submitted → live              | Provider's payouts Ready                                                                                                                     |
| Reject            | admin    | submitted → rejected          | Reason required                                                                                                                              |
| Unpublish         | admin    | live → unpublished            |                                                                                                                                              |
| Restore           | admin    | unpublished → live            | Same conditions as the original publish or approval                                                                                          |

Providers can edit draft and rejected listings. Editing a live listing is allowed for price, description, photos and sessions; see Open questions.

Suspending a provider hides all their listings immediately through the public read rule. Listings keep their status, so reinstating the provider brings them back.

## Access rules

| Table                             | Signed-out visitors                                | Providers                                                              | Admin                | Server only                                                                 |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| cities, service_areas, categories | Read active rows                                   | Read active rows                                                       | Read and write all   |                                                                             |
| listings                          | Read visible rows                                  | Read and write own; insert only as `draft`; delete own never-published | Read all             | `status`, `rejection_reason`, `submitted_at`, `reviewed_at`, `published_at` |
| listing_addresses                 | None                                               | Read and write own listing's                                           | Read all             |                                                                             |
| listing_service_areas             | Read for visible listings                          | Read and write own listing's                                           | Read all             |                                                                             |
| listing_photos                    | Read for visible listings                          | Read and write own listing's                                           | Read all, delete any |                                                                             |
| experience_sessions               | Read future scheduled sessions of visible listings | Read and write own listing's                                           | Read all             |                                                                             |

"Visible" means: listing `live`, provider `active`, category active, city active.

## Tests

One pgTAP file per table or closely related group. Every rule gets an allowed and a blocked case. At minimum:

- Signed-out visitors see a live listing, but not a draft, submitted, rejected or unpublished one.
- A live listing disappears when its provider is suspended, its category is deactivated, or its city is deactivated.
- A provider can't read or edit another provider's listing, address, photos or sessions.
- A provider can't set `status` to `live` or write any review field directly.
- A provider can create a listing only as `draft`, and only under their own provider record.
- A Service can't use an Experience category, and the reverse.
- A provider can delete a never-published listing but not one that has been live.
- Signed-out visitors can't read `listing_addresses`, even for a live listing.
- A ninth photo is rejected.
- A session can't be attached to a Service.
- Signed-out visitors don't see cancelled or past sessions.
- Only the admin can write cities, service areas and categories.
- The provider city migration leaves every provider with a valid `city_id`.

Break each new rule once to confirm its test fails, per the migrations skill.

## Server routes

Website, each starting with `requireProvider`:

- `POST /api/listings/:id/publish` (Services)
- `POST /api/listings/:id/submit` (Experiences)
- `POST /api/listings/:id/unlist`

Admin, each starting with `requireAdmin`:

- `POST /api/listings/:id/approve`
- `POST /api/listings/:id/reject` (body: reason)
- `POST /api/listings/:id/unpublish`
- `POST /api/listings/:id/restore`

Each route re-checks the conditions in Listing states on the server, updates the status with the server key, and returns the updated listing. Everything else (creating and editing listings, photos, addresses, sessions) goes through the Supabase client under the access rules.

## Screens

### Provider dashboard

- **Services** and **Experiences** pages replace the placeholders: a list of the provider's listings with status, and a Create button.
- **Listing editor**: category, title, description, price, duration, location (mode, area, address or service areas), photos with alt text and reordering. The editor shows what's missing before the Publish or Submit button is enabled, in plain language.
- **Sessions** (Experiences): add, edit or cancel dated sessions with capacity; times shown in the city's time zone.
- **Rejected Experiences** show the owner's reason at the top of the editor.
- **Onboarding checklist**: the third step becomes "Create your first listing", ticked when any listing is live or submitted.
- **Business profile**: city becomes a picker.

### Admin app

- **Categories**: list both kinds, create, edit, reorder, deactivate.
- **Cities and areas**: manage cities and their service areas.
- **Listings**: all listings with filters for kind, status, city and provider; unpublish and restore.
- **Review queue**: submitted Experiences, oldest first, with approve and reject (reason required).

## Build order

Each step is one migration plus tests, run through `db:test` before `db:push`.

1. Cities and service areas, then the providers `city_id` change and the city picker.
2. Categories, plus the admin Categories and Cities pages.
3. Listings, addresses and service areas, plus the provider Services and Experiences pages and the publish, submit and unlist routes.
4. Photos and the storage bucket, plus the photo section of the editor.
5. Experience sessions, plus the Sessions section.
6. Admin Listings page and review queue, with the approve, reject, unpublish and restore routes.

## Out of scope

Bookings, holds and checkout (step 4 of the product build order); public browse, category and listing pages (step 3); search; reviews; Service time slots; multiple team members per provider.

## Open questions

These don't block building steps 1 to 5 above.

- **Editing a live Experience.** Should changes to title, description or photos send it back for review? The first version lets edits go live immediately. Revisit before real hosts sign up.
- **Service areas for Atlanta.** Neighbourhoods, zip codes or both, and which ones. Needed before the first "I come to you" Service goes live.
- **Cancellation policy** stays open until booking management (product build step 5).
