import { serverSupabaseServiceRole } from "#supabase/server";
import type { Database } from "@repo/types";

// Publish: copies the guide's draft over its live copy and keeps a version
// (also "Publish changes" and "Publish again"). The database checks the
// draft first and refuses with a plain sentence.
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event);
  const db = serverSupabaseServiceRole<Database>(event);
  try {
    return await runGuideAction(db, "publish", getRouterParam(event, "id") ?? "", admin.sub);
  } catch (e) {
    if (e instanceof GuideActionError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
