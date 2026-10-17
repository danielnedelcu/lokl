import { serverSupabaseClient } from "#supabase/server";
import { supportMessageSchema, type Database } from "@repo/types";
import { z } from "zod";

// POST /api/provider/support-reports/:id/messages: the provider's reply on
// their report's thread; every admin is told, at once.
export default defineEventHandler(async (event) => {
  await requireProvider(event, "report_problems");
  const id = z.uuid().safeParse(getRouterParam(event, "id"));
  if (!id.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that report." });
  const { body } = await readValidatedBody(event, supportMessageSchema.parse);
  try {
    await addProviderMessage(await serverSupabaseClient<Database>(event), id.data, body);
    kickBookingEmails(event);
    return { ok: true };
  } catch (e) {
    if (e instanceof SupportError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
