-- Card-sized copies of listing photos (docs/design/browse-and-listing-pages.md,
-- Images: option D, decided 2026-09-30).
--
-- At upload the browser also saves a copy about 600px wide next to the full
-- photo: <provider>/<listing>/<uuid>.card.webp for the photo
-- <provider>/<listing>/<uuid>.<ext>, or .card.jpg where the browser can't
-- encode WebP. iPhone browsers all run Apple's engine, which may not, so the
-- JPEG fallback keeps card copies for most phone uploads. Browse cards and thumbnails use it; the
-- listing page and viewer use the full photo. Photos from before this change
-- have none, and pages fall back to the full photo.
--
-- Comments on objects (comment on ...) say what things mean. These `--`
-- comments say why the migration is written this way.

-- The card path must be the card copy of this row's own photo: same folder,
-- same file name, ".card.webp" or ".card.jpg". Checked against storage_path, so the photo's
-- folder rule (listing_photos_check) covers the card copy too, and a row can't
-- point its card at another photo or another listing's file.
--
-- Set when the photo is added and never changed: signed-in users can insert
-- any column, but may only update alt_text and position (listing photos
-- migration), so this needs no new grant.
alter table public.listing_photos
  add column card_path text unique,
  add constraint listing_photos_card_path_check
    check (card_path in (regexp_replace(storage_path, '\.(jpg|jpeg|png|webp)$', '.card.webp'),
                         regexp_replace(storage_path, '\.(jpg|jpeg|png|webp)$', '.card.jpg')));

comment on column public.listing_photos.card_path is
  'The card-sized copy (about 600px wide) of this photo, in the same folder: <uuid>.card.webp for <uuid>.<ext>, or <uuid>.card.jpg where the browser couldn''t encode WebP. Null for photos added before card copies existed; pages then use the full photo. Set on upload, never changed.';
