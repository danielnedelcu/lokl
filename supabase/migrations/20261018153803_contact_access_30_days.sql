-- Providers read a customer's email, phone and address only until 30 days
-- after the booking ends (docs/design/website-pages.md; decided
-- 2026-10-17). Before, they could read them for ever once the booking was
-- accepted. They keep the customer's name and the booking itself,
-- including the city and zip code copied onto it (bookings); customers and
-- admins keep everything. A booking without an end (none is confirmed
-- without a start) counts from its start.
--
-- The 30 days are CONTACT_ACCESS_DAYS in @repo/types, which the provider's
-- pages and the Terms for hosts use; the rule itself is here, where it's
-- enforced. now() is the real time, as for every enforced rule.

alter policy booking_contacts_read_provider on public.booking_contacts
  using (exists (select 1 from public.bookings b where b.id = booking_id
                   and b.provider_id = (select public.current_provider_id()) and b.confirmed_at is not null
                   and coalesce(b.ends_at, b.starts_at) > now() - interval '30 days'));
comment on policy booking_contacts_read_provider on public.booking_contacts is
  'Providers can read a customer''s email and phone once the booking is accepted or confirmed, until 30 days after it ends.';

alter policy booking_addresses_read_provider on public.booking_addresses
  using (exists (select 1 from public.bookings b where b.id = booking_id
                   and b.provider_id = (select public.current_provider_id()) and b.confirmed_at is not null
                   and coalesce(b.ends_at, b.starts_at) > now() - interval '30 days'));
comment on policy booking_addresses_read_provider on public.booking_addresses is
  'Providers can read the customer''s address once the booking is accepted, until 30 days after it ends.';
