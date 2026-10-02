import { serviceBookingRequestSchema } from "@repo/types";
import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/service: a Service request through Stripe Checkout,
// which holds the card until the provider accepts
// (docs/design/booking-and-checkout.md). Anyone signed in, except on their
// own listing (the database refuses that).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  if (!user.email) throw createError({ statusCode: 400, statusMessage: "Your login has no email address." });
  const input = await readValidatedBody(event, serviceBookingRequestSchema.parse);
  try {
    return await startServiceCheckout(
      { db: serverSupabaseServiceRole(event), stripe: useStripe(), siteUrl: useRuntimeConfig().public.siteUrl, customer: { id: user.sub, email: user.email } },
      input,
    );
  } catch (e) {
    if (e instanceof BookingError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
