import { serverSupabaseClient } from "#supabase/server";

// GET /api/provider/bookings: the signed-in provider's bookings in three
// groups (docs/design/booking-and-checkout.md, Provider pages). Read through
// RLS: bookings on their listings, and the customer's email, phone and
// address only once accepted or confirmed (the rows are simply missing
// before). Checkouts never finished aren't shown: the provider never had
// them as a request or a booking.
const FIELDS =
  "id, kind, status, listing_id, starts_at, ends_at, preferred_times, party_size, total_cents, provider_amount_cents, respond_by, " +
  "customer_name, customer_notes, customer_city, customer_postal_code, cancelled_by, created_at, " +
  "listing:listings(title, location_mode, duration_minutes, city:cities(name, timezone)), " +
  "contact:booking_contacts(email, phone), address:booking_addresses(line1, line2, city, state, postal_code, instructions)";

export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const { data, error } = await (await serverSupabaseClient(event))
    .from("bookings")
    .select(FIELDS)
    .eq("provider_id", provider.id)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[provider bookings]", error);
    throw createError({ statusCode: 500, statusMessage: "Your bookings didn't load. Please try again." });
  }
  const now = Date.now();
  const rows = ((data ?? []) as any[])
    // An expired booking with no answer-by time was a checkout never paid.
    .filter((b) => !(b.status === "expired" && !b.respond_by));
  const ended = (b: any) => Date.parse(b.ends_at ?? b.starts_at) <= now;
  const by = (key: string, dir: 1 | -1) => (a: any, b: any) => dir * (Date.parse(a[key] ?? a.created_at) - Date.parse(b[key] ?? b.created_at));
  return {
    requests: rows.filter((b) => b.status === "requested").sort(by("respond_by", 1)),
    upcoming: rows.filter((b) => b.status === "confirmed" && !ended(b)).sort(by("starts_at", 1)),
    past: rows.filter((b) => b.status !== "requested" && !(b.status === "confirmed" && !ended(b))).sort(by("starts_at", -1)),
  };
});
