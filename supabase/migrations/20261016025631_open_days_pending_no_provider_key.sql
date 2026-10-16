-- Deleting a provider failed once it had holds or hours (found 2026-10-16,
-- in the tests' clean-up): the cascade deletes their holds and hours, those
-- statements note the provider in service_open_days_pending for a refresh at
-- commit, and the note's foreign key refuses a provider being deleted. lokl
-- doesn't delete providers (they're suspended), but nothing should stop it.
--
-- The note needs no key: at commit, a provider that no longer exists has
-- nothing to refresh (refresh_service_open_days finds no Services), and the
-- note is deleted then either way.
alter table public.service_open_days_pending drop constraint service_open_days_pending_provider_id_fkey;

comment on column public.service_open_days_pending.provider_id is
  'The provider to refresh at commit. No foreign key: a provider deleted in the same transaction (its holds and hours going with it) is noted too, and simply has nothing to refresh.';
