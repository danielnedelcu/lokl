import { serverSupabaseClient } from "#supabase/server";

// GET /api/account/bookings: the signed-in customer's own bookings (RLS:
// bookings_read_customer), newest first, with each listing's display details.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const { data, error } = await (await serverSupabaseClient(event))
    .from("bookings")
    .select("id, kind, status, listing_id, starts_at, ends_at, preferred_times, party_size, total_cents, respond_by, customer_name, created_at")
    .eq("customer_id", user.sub)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false });
  if (error) throw createError({ statusCode: 500, statusMessage: "Your bookings didn't load. Please try again." });
  const listings = await listingDisplay(event, [...new Set((data ?? []).map((b) => b.listing_id))]);
  return (data ?? []).map((b) => ({ ...b, listing: listings.get(b.listing_id) ?? null }));
});
