import { GUIDE_PHOTO_BUCKET, type Database } from "@repo/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Deleting a guide (never published; the database refuses the rest): its
// row, which takes its photo rows with it, then its photo files from
// storage. Used by the guides list and the editor. Returns the error, or null.
export async function deleteGuideWithPhotos(supabase: SupabaseClient<Database>, guideId: string) {
  const { data: photos, error: pErr } = await supabase.from("guide_photos").select("storage_path, card_path").eq("guide_id", guideId);
  if (pErr) return pErr;
  // A delete that matched nothing (already gone, or not allowed) is an
  // error, never a silent success (changedRows).
  const error = changedRows(await supabase.from("guides").delete().eq("id", guideId).select("id"), "deleted");
  if (error) return error;
  const files = (photos ?? []).flatMap((p) => [p.storage_path, ...(p.card_path ? [p.card_path] : [])]);
  // A file left behind is only clutter, never shown; don't fail the delete for it.
  if (files.length) await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove(files);
  return null;
}

/**
 * An empty draft: never published, with no title, teaser, text or photos
 * (decided 2026-10-04: "New guide" creates the guide at once, so one opened
 * and left untouched shouldn't stay in the list). An area, category or the
 * placeholder address alone don't count as content.
 */
export function isEmptyDraft(g: { published_at: string | null; draft_title: string | null; draft_teaser: string | null; draft_body: unknown }, photoCount: number) {
  const blocks = (g.draft_body as { blocks?: unknown[] } | null)?.blocks ?? [];
  return !g.published_at && !g.draft_title?.trim() && !g.draft_teaser?.trim() && blocks.length === 0 && photoCount === 0;
}

/**
 * Removes empty drafts nobody has touched for an hour: left by a closed tab
 * rather than by leaving the editor (which discards them itself). The hour
 * keeps a new guide open in another tab safe. Returns how many went.
 */
export async function removeAbandonedDrafts(supabase: SupabaseClient<Database>) {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("guides")
    .select("id, published_at, draft_title, draft_teaser, draft_body, photos:guide_photos!guide_photos_guide_id_fkey(count)")
    .is("published_at", null)
    .eq("draft_title", "")
    .eq("draft_teaser", "")
    .lt("updated_at", hourAgo)
    .limit(50);
  if (error) return 0;
  let removed = 0;
  for (const g of data ?? []) {
    const photoCount = (g.photos as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
    if (isEmptyDraft(g, photoCount) && !(await deleteGuideWithPhotos(supabase, g.id))) removed++;
  }
  return removed;
}
