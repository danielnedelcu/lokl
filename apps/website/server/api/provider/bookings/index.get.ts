import { serverSupabaseClient } from "#supabase/server";

// GET /api/provider/bookings?tab=requests|upcoming|past&page=1: one page of
// the signed-in provider's bookings, with every tab's count, filtered,
// ordered and paged by the database (server/utils/providerBookingList.ts).
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event, "view_bookings");
  const q = getQuery(event);
  const tab = PROVIDER_BOOKING_TABS.includes(q.tab as ProviderBookingTab) ? (q.tab as ProviderBookingTab) : "requests";
  try {
    return await providerBookingsPage(await serverSupabaseClient(event), provider.id, tab, Number(q.page) || 1);
  } catch (e) {
    console.error("[provider bookings]", e);
    throw createError({ statusCode: 500, statusMessage: "Your bookings didn't load. Please try again." });
  }
});
