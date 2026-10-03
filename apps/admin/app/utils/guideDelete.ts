import { GUIDE_PHOTO_BUCKET, type Database } from "@repo/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Deleting a guide (never published; the database refuses the rest): its
// row, which takes its photo rows with it, then its photo files from
// storage. Used by the guides list and the editor. Returns the error, or null.
export async function deleteGuideWithPhotos(supabase: SupabaseClient<Database>, guideId: string) {
  const { data: photos, error: pErr } = await supabase.from("guide_photos").select("storage_path, card_path").eq("guide_id", guideId);
  if (pErr) return pErr;
  const { error } = await supabase.from("guides").delete().eq("id", guideId);
  if (error) return error;
  const files = (photos ?? []).flatMap((p) => [p.storage_path, ...(p.card_path ? [p.card_path] : [])]);
  // A file left behind is only clutter, never shown; don't fail the delete for it.
  if (files.length) await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove(files);
  return null;
}
