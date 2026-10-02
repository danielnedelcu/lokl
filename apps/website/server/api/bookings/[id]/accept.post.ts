import { z } from "zod";
import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/accept { startsAt }: the provider accepts one of
// the times the customer offered. The card hold is captured, and the
// customer's contact details (and address) become visible to the provider.
const body = z.object({ startsAt: z.iso.datetime({ offset: true }) });

export default defineEventHandler(async (event) => {
  const { booking } = await loadProviderBooking(event, getRouterParam(event, "id")!);
  const { startsAt } = await readValidatedBody(event, body.parse);
  const result = await answering(() => acceptRequest(serverSupabaseServiceRole(event), useStripe(), booking.id, startsAt));
  kickBookingEmails(event, booking.id);
  return { result };
});
