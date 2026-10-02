import { experienceBookingRequestSchema } from "@repo/types";
import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/experience: reserves spots for 30 minutes and opens
// Stripe Checkout, which charges at once (docs/design/booking-and-checkout.md).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  if (!user.email) throw createError({ statusCode: 400, statusMessage: "Your login has no email address." });
  const input = await readValidatedBody(event, experienceBookingRequestSchema.parse);
  try {
    return await startExperienceCheckout(
      { db: serverSupabaseServiceRole(event), stripe: useStripe(), siteUrl: useRuntimeConfig().public.siteUrl, customer: { id: user.sub, email: user.email } },
      input,
    );
  } catch (e) {
    if (e instanceof BookingError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
