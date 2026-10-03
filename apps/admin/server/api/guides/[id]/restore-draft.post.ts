import { z } from "zod";
import { serverSupabaseServiceRole } from "#supabase/server";
import type { Database } from "@repo/types";

// POST /api/guides/:id/restore-draft { logId, expectedUpdatedAt }: puts back
// the draft from before the guide's latest AI draft (once). Admins only.
const body = z.object({ logId: z.string(), expectedUpdatedAt: z.string().min(1) });

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { logId, expectedUpdatedAt } = await readValidatedBody(event, body.parse);
  try {
    return await restorePreviousDraft(serverSupabaseServiceRole<Database>(event), {
      guideId: getRouterParam(event, "id") ?? "",
      logId,
      expectedUpdatedAt,
    });
  } catch (e) {
    if (e instanceof GuideDraftError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
