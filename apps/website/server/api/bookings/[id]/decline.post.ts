import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/decline: the provider says no. The card hold is
// released, so nothing is charged.
export default defineEventHandler(async (event) => {
  const { booking } = await loadProviderBooking(event, getRouterParam(event, "id")!);
  const result = await answering(() => declineRequest(serverSupabaseServiceRole(event), useStripe(), booking.id));
  return { result };
});
