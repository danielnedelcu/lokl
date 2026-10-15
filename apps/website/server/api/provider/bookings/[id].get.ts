import { serverSupabaseClient } from "#supabase/server";

// GET /api/provider/bookings/:id: one booking on the provider's listings,
// read through RLS (contact details and address only once accepted), with
// its history. (A Service's slot was held when it was booked, so it can't
// overlap another booking: no clash warnings.)
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event, "view_bookings");
  const db = await serverSupabaseClient(event);
  const { data: b, error } = await db
    .from("bookings")
    .select(
      "id, kind, status, service_mode, listing_id, session_id, starts_at, ends_at, party_size, unit_price_cents, total_cents, " +
      "refunded_cents, respond_by, customer_name, customer_notes, customer_city, " +
      "customer_postal_code, cancelled_by, cancel_reason, confirmed_at, payout_due_at, problem_reported_at, created_at, " +
      "finances:booking_finances(commission_cents, provider_amount_cents, payout_hold), " +
      "listing:listings(title, kind, location_mode, duration_minutes, city:cities(name, timezone)), " +
      "contact:booking_contacts(email, phone), address:booking_addresses(line1, line2, city, state, postal_code, instructions), " +
      "events:booking_events(to_status, actor, created_at)",
    )
    .eq("id", getRouterParam(event, "id")!)
    .eq("provider_id", provider.id)
    .neq("status", "pending_payment")
    .maybeSingle();
  if (error) {
    console.error("[provider booking]", error);
    throw createError({ statusCode: 500, statusMessage: "This booking didn't load. Please try again." });
  }
  if (!b) throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
  // Flatten the money from booking_finances (RLS: their bookings only).
  const booking = { ...(b as any), ...((b as any).finances ?? {}), finances: undefined };

  const events = [...(booking.events ?? [])].sort((x: any, y: any) => Date.parse(x.created_at) - Date.parse(y.created_at));
  return { ...booking, events };
});
