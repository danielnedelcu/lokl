import { serverSupabaseClient } from "#supabase/server";

// GET /api/provider/bookings/:id: one booking on the provider's listings,
// read through RLS (contact details and address only once accepted), with
// its history and, for a request, which offered times overlap the
// provider's confirmed bookings (a warning only).
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event, "view_bookings");
  const db = await serverSupabaseClient(event);
  const { data: b, error } = await db
    .from("bookings")
    .select(
      "id, kind, status, listing_id, session_id, starts_at, ends_at, preferred_times, party_size, unit_price_cents, total_cents, " +
      "commission_cents, provider_amount_cents, refunded_cents, respond_by, customer_name, customer_notes, customer_city, " +
      "customer_postal_code, cancelled_by, cancel_reason, confirmed_at, payout_due_at, payout_hold, problem_reported_at, created_at, " +
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
  const booking = b as any;

  let clashes: { id: string; starts_at: string; ends_at: string | null; title: string }[][] = [];
  if (booking.status === "requested" && booking.preferred_times?.length) {
    const times = booking.preferred_times.map((t: string) => Date.parse(t));
    const from = new Date(Math.min(...times) - 24 * 3600_000).toISOString();
    const to = new Date(Math.max(...times) + 24 * 3600_000).toISOString();
    const { data: confirmed } = await db
      .from("bookings")
      .select("id, starts_at, ends_at, listing:listings(title)")
      .eq("provider_id", provider.id)
      .eq("status", "confirmed")
      .gte("starts_at", from)
      .lte("starts_at", to);
    clashes = requestOverlaps(
      booking.preferred_times,
      booking.listing?.duration_minutes ?? 60,
      ((confirmed ?? []) as any[]).map((c) => ({ id: c.id, starts_at: c.starts_at, ends_at: c.ends_at, title: c.listing?.title ?? "A booking" })),
    );
  }
  const events = [...(booking.events ?? [])].sort((x: any, y: any) => Date.parse(x.created_at) - Date.parse(y.created_at));
  return { ...booking, events, clashes };
});
