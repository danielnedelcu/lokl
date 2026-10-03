import { serverSupabaseClient } from "#supabase/server";
import type { ServerEvent } from "./provider";

// A booking on one of the signed-in provider's listings, for the accept and
// decline routes. requireProvider checks they own an active business; the
// read goes through their own client, so RLS proves the booking is theirs.
// (A customer reading their own booking would pass RLS, hence the
// provider_id check.)
export async function loadProviderBooking(event: ServerEvent, id: string) {
  const provider = await requireProvider(event, "answer_requests");
  const { data } = await (await serverSupabaseClient(event))
    .from("bookings").select("id, provider_id").eq("id", id).maybeSingle();
  if (!data || data.provider_id !== provider.id) {
    throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
  }
  return { provider, booking: data as { id: string; provider_id: string } };
}

// Booking routes turn BookingErrors into plain answers.
export async function answering<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof BookingError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
}
