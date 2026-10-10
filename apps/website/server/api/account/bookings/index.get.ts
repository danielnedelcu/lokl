import { serverSupabaseClient } from "#supabase/server";

// GET /api/account/bookings?group=upcoming|past|latest&page=1: a page of the
// signed-in customer's own bookings (RLS: bookings_read_customer), counted
// and paged by the database (server/utils/customerBookingList.ts), with each
// listing's display details.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const q = getQuery(event);
  const group = CUSTOMER_BOOKING_GROUPS.includes(q.group as CustomerBookingGroup) ? (q.group as CustomerBookingGroup) : "upcoming";
  let page;
  try {
    page = await customerBookingsPage(await serverSupabaseClient(event), user.sub, group, Number(q.page) || 1);
  } catch {
    throw createError({ statusCode: 500, statusMessage: "Your bookings didn't load. Please try again." });
  }
  const listings = await listingDisplay(event, [...new Set(page.items.map((b) => b.listing_id as string))]);
  return { ...page, items: page.items.map((b) => ({ ...b, listing: listings.get(b.listing_id) ?? null })) };
});
