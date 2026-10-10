-- Who may call each function (docs/TODO.md, Hardening; 2026-10-10).
--
-- Postgres gives every new function EXECUTE for PUBLIC, so 47 functions in
-- public could be called by anyone, signed-out visitors included. This
-- states, per function, exactly which roles may call it, and stops new
-- functions getting PUBLIC EXECUTE. Tested before writing it (the whole
-- pgTAP suite, the app tests and the end-to-end tests with it applied):
-- - a trigger fires even when the writing role can't execute its function,
--   so trigger functions need no API grant at all;
-- - a check constraint, and an ordinary (invoker) trigger, run as the
--   writing role, so the functions they call need its EXECUTE;
-- - a helper inside an access rule runs as the role the rule is checking.
-- supabase/tests/function_privileges.test.sql keeps it so: no PUBLIC
-- EXECUTE anywhere, each helper's callers, and the list of security-definer
-- functions allowed to reach visitors or signed-in users.

-- 1. Trigger functions: a trigger fires without the writer holding EXECUTE
--    on its function (tested), and they can't be called any other way.
revoke execute on function
  public.booking_finances_guard(),
  public.booking_finances_queue_emails(),
  public.booking_finances_released_only_grows(),
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
  public.experience_sessions_booked_guard(),
  public.experience_sessions_check(),
  public.experience_sessions_guard(),
  public.guide_photos_in_own_folder(),
  public.guides_area_in_market(),
  public.guides_cover_is_own(),
  public.guides_guard(),
  public.homepage_features_published_only(),
  public.listing_addresses_guard(),
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
  from public, anon, authenticated, service_role;

-- 2. The helpers: exactly the roles that evaluate them.
-- is_admin(): 43 access rules for signed-in users; admin_set_homepage_features (invoker) is called by the admin, signed in.
revoke execute on function public.is_admin() from public, anon, service_role;
grant execute on function public.is_admin() to authenticated;
-- current_provider_id(): 33 access rules for signed-in users; reorder_listing_photos (invoker) is called by providers, signed in.
revoke execute on function public.current_provider_id() from public, anon, service_role;
grant execute on function public.current_provider_id() to authenticated;
-- listing_parents_active(): access rules for visitors and signed-in users; reserve_experience_booking and
-- create_service_request (invoker) are called by the server key.
revoke execute on function public.listing_parents_active(uuid, uuid, uuid) from public;
grant execute on function public.listing_parents_active(uuid, uuid, uuid) to anon, authenticated, service_role;
-- has_contact_details(): check constraints on reviews, replies and providers run as the writer
-- (tested): signed-in users and the server key write those tables.
revoke execute on function public.has_contact_details(text) from public, anon;
grant execute on function public.has_contact_details(text) to authenticated, service_role;
-- provider_slug(): only providers_set_slug calls it. That trigger becomes security definer
-- (it only fills new.slug; search_path is already empty), so no API role needs provider_slug,
-- and nobody can probe which business names are taken.
alter function public.providers_set_slug() security definer;
revoke execute on function public.provider_slug(text) from public, anon, authenticated, service_role;
-- review_display_name(): only called by security-definer functions (reviews_fill, review_state).
revoke execute on function public.review_display_name(text) from public, anon, authenticated, service_role;

-- 3. From now on, new functions get no PUBLIC EXECUTE; each migration grants
--    its callers explicitly (service_role keeps the default from
--    explicit_api_grants). This one is global, without "in schema": a
--    per-schema default can only add to the global ones, and PUBLIC EXECUTE
--    on functions is a global default, so revoking it "in schema public"
--    changes nothing (caught by function_privileges.test.sql, 6c). It
--    covers functions postgres creates in any schema (public and private).
alter default privileges for role postgres revoke execute on functions from public;
