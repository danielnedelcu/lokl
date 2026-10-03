import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@repo/types";

// Publishing and unpublishing guides (docs/design/destination-guides.md):
// the only way a guide's status or live copy changes. The checks themselves
// are in the database (publish_guide(), unpublish_guide()), so they hold for
// any caller; this turns their refusals into plain answers.

export type GuideAction = "publish" | "unpublish";

export class GuideActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const guideId = z.uuid();

/** Runs publish_guide() or unpublish_guide() with the server key, as the given admin. */
export async function runGuideAction(db: SupabaseClient<Database>, action: GuideAction, id: string, adminId: string) {
  if (!guideId.safeParse(id).success) throw new GuideActionError(404, "We couldn't find that guide.");
  const { error } = await db.rpc(action === "publish" ? "publish_guide" : "unpublish_guide", { p_guide_id: id, p_admin_id: adminId });
  if (!error) return { result: action === "publish" ? "published" : "unpublished" };
  // The database's own sentences (check_violation) are written for the admin.
  if (error.code === "23514") throw new GuideActionError(409, error.message);
  if (error.code === "42501") throw new GuideActionError(403, "Only an admin can do this.");
  if (error.code === "P0002") throw new GuideActionError(404, "We couldn't find that guide.");
  console.error(`[admin api] ${action}_guide failed`, error);
  throw new GuideActionError(500, "Something went wrong on our side. Try again, or check the server logs.");
}
