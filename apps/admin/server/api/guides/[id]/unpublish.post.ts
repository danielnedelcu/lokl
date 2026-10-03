import { serverSupabaseServiceRole } from "#supabase/server";
import type { Database } from "@repo/types";

// Unpublish: takes a published guide off the site and the homepage. Its
// address stops working until it's published again.
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event);
  const db = serverSupabaseServiceRole<Database>(event);
  try {
    return await runGuideAction(db, "unpublish", getRouterParam(event, "id") ?? "", admin.sub);
  } catch (e) {
    if (e instanceof GuideActionError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
