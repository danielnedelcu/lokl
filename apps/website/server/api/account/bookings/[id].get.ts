import { serverSupabaseClient } from "#supabase/server";

// GET /api/account/bookings/:id: one of the customer's own bookings, with the
// address they're allowed to see. Everything private is read with their own
// client, so the database's rules decide: the listing's exact address only
// once confirmed (listing_addresses_read_booked_customer), and the address
// they gave for "I come to you".
export default defineEventHandler(async (event) => {
  await requireUser(event);
  const id = getRouterParam(event, "id")!;
  const db = await serverSupabaseClient(event);
  const { data: b } = await db
    .from("bookings")
    .select("id, kind, status, listing_id, starts_at, ends_at, preferred_times, party_size, unit_price_cents, total_cents, refunded_cents, customer_name, customer_notes, respond_by, confirmed_at, cancelled_at, cancelled_by, created_at")
    .eq("id", id).maybeSingle();
  if (!b) throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
  const [listingAddress, givenAddress] = await Promise.all([
    db.from("listing_addresses").select("line1, line2, city, state, postal_code, instructions").eq("listing_id", b.listing_id).maybeSingle(),
    db.from("booking_addresses").select("line1, line2, city, state, postal_code, instructions").eq("booking_id", b.id).maybeSingle(),
  ]);
  const listings = await listingDisplay(event, [b.listing_id]);
  return { ...b, listing: listings.get(b.listing_id) ?? null, listingAddress: listingAddress.data ?? null, givenAddress: givenAddress.data ?? null };
});
