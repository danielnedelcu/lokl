import { z } from "zod";
import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/report-problem { note }: the customer says the
// provider didn't show up. Holds the payout at once; the note is for lokl
// only (the provider's bell just says a problem was reported). The database
// allows it once, from the start until the payout time.
const body = z.object({ note: z.string().trim().min(10, "Say what happened, in a sentence or two.").max(1000, "Keep it under 1,000 characters.") });

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const booking = await loadCustomerBooking(event, getRouterParam(event, "id")!);
  if (booking.customer_id !== user.sub) throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
  const { note } = await readValidatedBody(event, body.parse);
  const result = await answering(() => reportProblem(serverSupabaseServiceRole(event), booking.id, note));
  kickBookingEmails(event, booking.id);
  return { result };
});
