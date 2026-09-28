-- Why the owner took a listing down (build step 6: admin Listings page and
-- review queue). The provider sees the reason in their editor, so they know
-- what to fix or who to contact.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- Server-only, like rejection_reason: signed-in users have no table-wide
-- update grant on listings (only the columns granted in the listings
-- migration), so a new column is not writable by providers. Providers read it
-- through listings_read_own; the public never sees it, because a live listing
-- can't have one (below).
alter table public.listings
  add column unpublished_reason text
    check (char_length(unpublished_reason) between 10 and 1000);

-- An unpublished listing always says why, and the reason goes when it's
-- restored, so a live listing never carries an old one.
alter table public.listings
  add constraint listings_unpublished_reason check (
    (status = 'unpublished') = (unpublished_reason is not null)
  );

comment on column public.listings.unpublished_reason is
  'Why the owner took the listing down, 10 to 1,000 characters; shown to the provider. Set when unpublished; cleared on restore. Server-only.';
