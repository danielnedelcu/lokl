import { serverSupabaseClient } from "#supabase/server";
import { supportReportSchema, type Database } from "@repo/types";

// POST /api/provider/support-reports: "Report a problem"
// (docs/design/problem-reports.md). As the provider's own login, so the
// database's rules decide; then the emails go out at once (a Safety report
// emails every admin now, not at the next job).
export default defineEventHandler(async (event) => {
  await requireProvider(event, "report_problems");
  const input = await readValidatedBody(event, supportReportSchema.parse);
  try {
    const id = await createSupportReport(await serverSupabaseClient<Database>(event), input);
    kickBookingEmails(event);
    return { id };
  } catch (e) {
    if (e instanceof SupportError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
