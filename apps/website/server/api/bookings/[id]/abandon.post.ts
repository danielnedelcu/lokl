import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/abandon: the customer came back from Checkout
// without paying. Expires the Checkout Session only if Stripe says it's still
// open, which frees the spots or request at once; a paid booking is never
// touched (abandonCheckout re-reads first). The customer's own booking only.
export default defineEventHandler(async (event) => {
  const booking = await loadCustomerBooking(event, getRouterParam(event, "id")!);
  if (booking.stripe_checkout_session_id && booking.status === "pending_payment") {
    await abandonCheckout(serverSupabaseServiceRole(event), useStripe(), booking.stripe_checkout_session_id);
  }
  const { data } = await serverSupabaseServiceRole(event).from("bookings").select("status").eq("id", booking.id).single();
  return { status: data!.status };
});
