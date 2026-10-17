import { serverSupabaseClient } from "#supabase/server";
import type { Database } from "@repo/types";
import { z } from "zod";

// POST /api/provider/support-reports/:id/sorted: "This is sorted". The
// database refuses a Safety report (only lokl closes those).
export default defineEventHandler(async (event) => {
  await requireProvider(event, "report_problems");
  const id = z.uuid().safeParse(getRouterParam(event, "id"));
  if (!id.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that report." });
  try {
    await markSupportReportSorted(await serverSupabaseClient<Database>(event), id.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof SupportError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
