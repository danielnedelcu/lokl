import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/sync: the confirmation page asks for its booking to
// be brought up to date with Stripe, in case the webhook is late (or not
// forwarded in development). Same logic as the webhook. The customer's own
// booking only.
export default defineEventHandler(async (event) => {
  const booking = await loadCustomerBooking(event, getRouterParam(event, "id")!);
  if (!booking.stripe_checkout_session_id) return { status: booking.status };
  await syncCheckoutSession(serverSupabaseServiceRole(event), useStripe(), booking.stripe_checkout_session_id);
  const { data } = await serverSupabaseServiceRole(event).from("bookings").select("status").eq("id", booking.id).single();
  kickBookingEmails(event, booking.id);
  return { status: data!.status };
});
