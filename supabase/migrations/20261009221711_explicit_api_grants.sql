-- Explicit API grants (docs/TODO.md; practice from The Reserve, 2026-10-09).
--
-- Until now the API roles (anon, authenticated, service_role) got much of
-- their access from the Supabase CLI's default privileges, because
-- supabase/config.toml left auto_expose_new_tables unset (true). The CLI
-- removes that option on 2026-10-30, and a stack built with it off failed
-- 26 of 27 pgTAP files and the app tests' setup ("permission denied").
-- The hosted project has the same defaults, and a new project (production)
-- may not.
--
-- This migration states, explicitly, every grant that exists today and came
-- from those defaults, so nothing depends on them. It changes no behaviour,
-- apart from:
-- - removing TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from the API roles
--   on every table (nothing in the apps uses them);
-- - setting the default privileges for what postgres creates in public from
--   now on: service_role only (anon and authenticated get nothing until a
--   migration grants it, as every recent migration already does).
--
-- Postgres's own PUBLIC EXECUTE on functions is left as it is; which helper
-- functions should keep it is a separate step (docs/TODO.md).
--
-- The lists were generated from the database as it is today (identical to
-- the hosted project; scripts/schema-compare.mjs). Some restate grants an
-- earlier migration already made; granting twice changes nothing.

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

-- The server (service role) reads and writes every table, after its own
-- checks; row rules don't apply to it.
grant select, insert, update, delete on table
  public.admin_actions,
  public.booking_addresses,
  public.booking_contacts,
  public.booking_emails,
  public.booking_events,
  public.booking_finances,
  public.booking_reports,
  public.bookings,
  public.categories,
  public.cities,
  public.commission_rate_changes,
  public.commission_rates,
  public.experience_sessions,
  public.guide_ai_drafts,
  public.guide_photos,
  public.guide_versions,
  public.guides,
  public.homepage_features,
  public.job_runs,
  public.listing_addresses,
  public.listing_photos,
  public.listing_ratings,
  public.listing_service_areas,
  public.listings,
  public.notifications,
  public.provider_emails,
  public.provider_ratings,
  public.providers,
  public.review_replies,
  public.review_reports,
  public.reviews,
  public.saved_listings,
  public.saved_providers,
  public.service_areas
  to service_role;

-- Signed-in users: table-level grants they hold today. Row rules (RLS)
-- still decide which rows; column grants elsewhere decide which columns.
grant select on table
  public.admin_actions,
  public.booking_addresses,
  public.booking_contacts,
  public.booking_emails,
  public.booking_events,
  public.booking_finances,
  public.booking_reports,
  public.bookings,
  public.commission_rate_changes,
  public.commission_rates,
  public.guide_ai_drafts,
  public.guide_versions,
  public.job_runs,
  public.notifications,
  public.provider_emails,
  public.providers
  to authenticated;
grant select, delete on table
  public.experience_sessions,
  public.guides,
  public.listings,
  public.saved_listings,
  public.saved_providers
  to authenticated;
grant select, insert, delete on table
  public.guide_photos,
  public.listing_photos,
  public.listing_service_areas
  to authenticated;
grant delete on table
  public.review_replies,
  public.reviews
  to authenticated;
grant select, insert, update on table
  public.cities,
  public.service_areas
  to authenticated;
grant select, insert, update, delete on table
  public.homepage_features,
  public.listing_addresses
  to authenticated;
grant select, insert on table
  public.categories
  to authenticated;

-- Visitors: the public tables they read today (row rules show only what's
-- public).
grant select on table
  public.categories,
  public.cities,
  public.experience_sessions,
  public.homepage_features,
  public.listing_photos,
  public.listing_service_areas,
  public.listings,
  public.service_areas
  to anon;

-- Never used by the apps, and dangerous to leave with the API roles.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- FUNCTIONS
-- ---------------------------------------------------------------------------

-- These revoke PUBLIC and grant signed-in users explicitly; the server
-- relied on the defaults to call them.
grant execute on function
  public.admin_bookings_page(p_q text, p_status text, p_kind text, p_provider_id uuid, p_from date, p_to date, p_attention text, p_sort text, p_desc boolean, p_page integer, p_page_size integer, p_with_attention boolean, p_paid_from date, p_paid_to date),
  public.admin_dashboard(),
  public.admin_listings_page(p_kind text, p_q text, p_status text, p_city_id uuid, p_provider_id uuid, p_sort text, p_desc boolean, p_page integer, p_page_size integer),
  public.admin_providers_page(p_q text, p_status text, p_payout_setup text, p_city_id uuid, p_sort text, p_desc boolean, p_page integer, p_page_size integer, p_paid_since date),
  public.admin_reviews_page(p_reported boolean, p_status text, p_provider_id uuid, p_rating integer, p_page integer, p_page_size integer),
  public.admin_search_patterns(p_q text),
  public.admin_set_homepage_features(p_guide_ids uuid[]),
  public.booking_can_be_reviewed(p_booking_id uuid),
  public.booking_emails_queue(p_booking_id uuid, p_kinds text[]),
  public.booking_finances_released_only_grows(),
  public.booking_money(p_kind text, p_unit_price integer, p_party smallint, OUT total integer, OUT rate integer, OUT commission integer, OUT provider_amount integer),
  public.current_active_provider_id(),
  public.my_saved(),
  public.provider_is_public(p_provider_id uuid),
  public.provider_payout_setup(p_account_id text, p_charges boolean, p_payouts boolean),
  public.public_guide(p_market text, p_slug text),
  public.public_guide_photo_json(p guide_photos),
  public.public_guides(p_market text),
  public.public_homepage_guides(),
  public.recount_ratings(p_listing_id uuid, p_provider_id uuid),
  public.reorder_listing_photos(p_listing_id uuid, p_photo_ids uuid[]),
  public.review_display_name(p_name text),
  public.review_reportable(p_review_id uuid, p_target text),
  public.review_state(p_booking_id uuid),
  public.review_window_open(p_booking_id uuid),
  public.session_spots_left(p_session_id uuid),
  public.session_spots_taken(p_session_id uuid)
  to service_role;

-- These still have Postgres's PUBLIC EXECUTE (mostly trigger functions,
-- plus the helpers used inside row rules). The roles' own grants came from
-- the defaults; restated here so the catalogue is the same either way.
grant execute on function
  public.booking_finances_guard(),
  public.booking_finances_queue_emails(),
  public.booking_reports_final(),
  public.bookings_clear_hold_when_refunded(),
  public.bookings_guard(),
  public.bookings_log_status(),
  public.bookings_notify_problem(),
  public.bookings_notify_provider(),
  public.bookings_queue_emails(),
  public.bookings_queue_review_request(),
  public.commission_rates_log_change(),
  public.commission_rates_stamp(),
  public.current_provider_id(),
  public.experience_sessions_booked_guard(),
  public.experience_sessions_check(),
  public.experience_sessions_guard(),
  public.guide_photos_in_own_folder(),
  public.guides_area_in_market(),
  public.guides_cover_is_own(),
  public.guides_guard(),
  public.has_contact_details(p_text text),
  public.homepage_features_published_only(),
  public.is_admin(),
  public.listing_addresses_guard(),
  public.listing_parents_active(p_provider_id uuid, p_category_id uuid, p_city_id uuid),
  public.listing_photos_check(),
  public.listing_photos_guard(),
  public.listing_service_areas_check(),
  public.listing_service_areas_guard(),
  public.listings_check_references(),
  public.listings_guard_provider_edits(),
  public.listings_notify_status_change(),
  public.listings_require_photo(),
  public.listings_set_slug(),
  public.notifications_set_read_at(),
  public.provider_slug(p_name text),
  public.providers_check_city_active(),
  public.providers_owner_not_admin(),
  public.providers_set_slug(),
  public.review_replies_fill(),
  public.reviews_fill(),
  public.reviews_guard(),
  public.reviews_notify_provider(),
  public.reviews_recount(),
  public.saved_items_limit(),
  public.set_updated_at()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- DEFAULT PRIVILEGES (objects postgres creates in public from now on)
-- ---------------------------------------------------------------------------

-- The server can use a new table, sequence or function at once; signed-in
-- users and visitors get nothing until the migration that makes it says so.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
