import { serverSupabaseClient, serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

// A signed-in customer's own booking, for the sync and abandon routes: read
// with their own client, so RLS proves it's theirs.
export async function loadCustomerBooking(event: ServerEvent, id: string) {
  await requireUser(event);
  const { data } = await (await serverSupabaseClient(event))
    .from("bookings").select("id, customer_id, status").eq("id", id).maybeSingle();
  if (!data) throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
  // The checkout id is on booking_finances, which customers can't read:
  // fetched with the server key, now that RLS has shown the booking is
  // visible to this user.
  const { data: f } = await serverSupabaseServiceRole(event)
    .from("booking_finances").select("stripe_checkout_session_id").eq("booking_id", data.id).maybeSingle();
  return { ...data, stripe_checkout_session_id: f?.stripe_checkout_session_id ?? null } as {
    id: string; customer_id: string; status: string; stripe_checkout_session_id: string | null;
  };
}

// What a booking page shows about its listing. Read with the server key
// because a listing taken down since isn't public any more, but it's still
// the customer's booking; only display fields, for listings they've booked.
export async function listingDisplay(event: ServerEvent, listingIds: string[]) {
  if (!listingIds.length) return new Map();
  const { data, error } = await serverSupabaseServiceRole(event)
    .from("listings")
    .select("id, kind, slug, title, location_mode, duration_minutes, status, city:cities(name, timezone), photos:listing_photos(storage_path, card_path, alt_text, position), provider:providers(display_name)")
    .in("id", listingIds);
  if (error) throw createError({ statusCode: 500, statusMessage: "Your bookings didn't load. Please try again." });
  return new Map((data ?? []).map((l: any) => {
    const cover = [...(l.photos ?? [])].sort((a: any, b: any) => a.position - b.position)[0];
    return [l.id, {
      kind: l.kind, slug: l.slug, title: l.title, locationMode: l.location_mode, durationMinutes: l.duration_minutes,
      isLive: l.status === "live", market: l.city?.name ?? "", timezone: l.city?.timezone ?? "America/New_York",
      // The business's public name (the reply to their review is "from" it).
      providerName: l.provider?.display_name ?? "the provider",
      cover: cover ? { path: cover.card_path ?? cover.storage_path, alt: cover.alt_text } : null,
    }];
  }));
}
