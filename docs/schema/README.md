# postgres

## Tables

| Name                                                            | Columns | Comment                                                                                                                                                                                                                                                                                                                                       | Type       |
| --------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [public.providers](public.providers.md)                         | 11      | A business or host that sells Services or Experiences. One per login (owner_id is unique). Never deleted: bookings and payouts will point here, so a provider is suspended instead.                                                                                                                                                           | BASE TABLE |
| [public.cities](public.cities.md)                               | 9       | The places lokl operates. Admin-managed. Never deleted: providers and listings point here, so a city is deactivated instead.                                                                                                                                                                                                                  | BASE TABLE |
| [public.service_areas](public.service_areas.md)                 | 8       | Neighborhoods or zip codes within a city. Where "I come to you" Services travel, and the public location label on listings. Admin-managed. Never deleted: listings will point here, so an area is deactivated instead.                                                                                                                        | BASE TABLE |
| [public.categories](public.categories.md)                       | 9       | Service and Experience categories. Flat and admin-managed; each listing belongs to one category of its own kind. Never deleted: listings will point here, so a category is deactivated instead.                                                                                                                                               | BASE TABLE |
| [public.listings](public.listings.md)                           | 20      | A Service or Experience a provider offers. Deleted only while it has never been live (published_at is null); after that it is unlisted or unpublished, never deleted, because bookings will point at it.                                                                                                                                      | BASE TABLE |
| [public.listing_addresses](public.listing_addresses.md)         | 9       | A listing's exact address. Private: readable only by the listing's provider and the admin (customers with a confirmed booking come later). Required for provider-location Services and Experiences before publishing or submitting. Deleted with its listing, or by the provider when it is no longer needed.                                 | BASE TABLE |
| [public.listing_service_areas](public.listing_service_areas.md) | 3       | Where an "I come to you" Service travels. At least one row is required before a customer-location Service can go live. Rows go with their listing; the provider removes a row to stop covering an area.                                                                                                                                       | BASE TABLE |
| [public.listing_photos](public.listing_photos.md)               | 7       | Photos of a listing, at most 8. Position 0 is the cover. At least one is required before a listing is published or submitted. Removed by the provider (not while submitted or unpublished, and never the last one of a live listing) or by the admin; rows go with their listing. Removing a row leaves the stored file.                      | BASE TABLE |
| [public.experience_sessions](public.experience_sessions.md)     | 7       | Dated sessions of an Experience, each with a number of spots. Providers add and change future sessions (not while the listing is submitted or unpublished); a session that has started is kept as it is. Deleted with their listing, or by the provider before they start; once bookings exist, a session with bookings is cancelled instead. | BASE TABLE |

## Stored procedures and functions

| Name                                 | ReturnType | Arguments                                              | Type     |
| ------------------------------------ | ---------- | ------------------------------------------------------ | -------- |
| public.is_admin                      | bool       |                                                        | FUNCTION |
| public.set_updated_at                | trigger    |                                                        | FUNCTION |
| public.providers_check_city_active   | trigger    |                                                        | FUNCTION |
| public.current_provider_id           | uuid       |                                                        | FUNCTION |
| public.listing_parents_active        | bool       | p_provider_id uuid, p_category_id uuid, p_city_id uuid | FUNCTION |
| public.listings_set_slug             | trigger    |                                                        | FUNCTION |
| public.listings_check_references     | trigger    |                                                        | FUNCTION |
| public.listings_guard_provider_edits | trigger    |                                                        | FUNCTION |
| public.listing_service_areas_check   | trigger    |                                                        | FUNCTION |
| public.listing_addresses_guard       | trigger    |                                                        | FUNCTION |
| public.listing_service_areas_guard   | trigger    |                                                        | FUNCTION |
| public.listing_photos_check          | trigger    |                                                        | FUNCTION |
| public.listing_photos_guard          | trigger    |                                                        | FUNCTION |
| public.listings_require_photo        | trigger    |                                                        | FUNCTION |
| public.reorder_listing_photos        | void       | p_listing_id uuid, p_photo_ids uuid[]                  | FUNCTION |
| public.experience_sessions_check     | trigger    |                                                        | FUNCTION |
| public.experience_sessions_guard     | trigger    |                                                        | FUNCTION |

## Enums

| Name | Values |
| ---- | ------- |
| auth.aal_level | aal1, aal2, aal3 |
| auth.code_challenge_method | plain, s256 |
| auth.factor_status | unverified, verified |
| auth.factor_type | phone, recovery_code, totp, webauthn |
| auth.oauth_authorization_status | approved, denied, expired, pending |
| auth.oauth_client_type | confidential, public |
| auth.oauth_registration_type | dynamic, manual |
| auth.oauth_response_type | code |
| auth.one_time_token_type | confirmation_token, email_change_token_current, email_change_token_new, phone_change_token, reauthentication_token, recovery_token |
| realtime.action | DELETE, ERROR, INSERT, TRUNCATE, UPDATE |
| realtime.equality_op | eq, gt, gte, ilike, imatch, in, is, isdistinct, like, lt, lte, match, neq |
| storage.buckettype | ANALYTICS, STANDARD, VECTOR |

## Relations

![er](schema.svg)

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
