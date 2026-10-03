import type { SupabaseClient } from "@supabase/supabase-js";
import { photoCredit, GUIDE_PHOTO_BUCKET, type GuideBodyPhoto, type GuidePhoto } from "@repo/types";

/** A guide's photos by id, as the body renderer (GuideBody) and the photo block need them. */
export function guidePhotoMap(supabase: SupabaseClient, photos: GuidePhoto[]): Record<string, GuideBodyPhoto & { cardUrl: string }> {
  const url = (path: string) => supabase.storage.from(GUIDE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  return Object.fromEntries(
    photos.map((p) => [
      p.id,
      { url: url(p.storage_path), cardUrl: url(p.card_path ?? p.storage_path), width: p.width, height: p.height, alt: p.alt_text, credit: photoCredit(p) },
    ]),
  );
}
