import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/accept: the provider accepts a request for the slot
// the customer booked (docs/design/service-availability.md: the time is
// fixed, so there's nothing to choose). The card hold is captured, and the
// customer's contact details (and address) become visible to the provider.
export default defineEventHandler(async (event) => {
  const { booking } = await loadProviderBooking(event, getRouterParam(event, "id")!);
  const result = await answering(() => acceptRequest(serverSupabaseServiceRole(event), useStripe(), booking.id));
  kickBookingEmails(event, booking.id);
  return { result };
});
