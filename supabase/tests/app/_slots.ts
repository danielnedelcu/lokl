// Slot bookings for the app tests (docs/design/service-availability.md):
// Services are booked from slots only (create_service_booking), so a test
// that books one opens its provider's hours and picks a free slot. Against
// the local stack, with the service role.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Opens a provider all day, every day (if they have no hours yet). Slots
 * also need payouts set up: the tests that book a Service set the provider's
 * Stripe account up themselves, or pass `payouts` to have it marked ready.
 */
export async function makeBookable(db: SupabaseClient, providerId: string, { payouts = false } = {}) {
  const { count } = await db.from("provider_weekly_hours").select("id", { count: "exact", head: true }).eq("provider_id", providerId);
  if (!count) {
    const { error } = await db.from("provider_weekly_hours")
      .insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ provider_id: providerId, weekday, starts: "00:00", ends: "24:00" })));
    if (error) throw new Error(`hours: ${error.message}`);
  }
  if (payouts) {
    const { data: p } = await db.from("providers").select("stripe_account_id").eq("id", providerId).single();
    const { error } = await db.from("providers").update({
      stripe_account_id: p?.stripe_account_id ?? `acct_test_${providerId.replace(/-/g, "").slice(0, 12)}`,
      stripe_charges_enabled: true, stripe_payouts_enabled: true,
    }).eq("id", providerId);
    if (error) throw new Error(error.message);
  }
}

/**
 * The first free slot of a listing at least `afterMs` from now (within a
 * week of it), as an ISO string, after making its provider bookable.
 */
export async function slotAfter(db: SupabaseClient, listingId: string, afterMs: number): Promise<string> {
  // The listing's provider, open all day with payouts set up, if not already.
  const { data: l } = await db.from("listings").select("provider_id").eq("id", listingId).single();
  if (l) await makeBookable(db, l.provider_id as string, { payouts: true });
  const from = new Date(Date.now() + afterMs);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const { data, error } = await db.rpc("service_slots", { p_listing_id: listingId, p_from: day(from), p_to: day(new Date(from.getTime() + 6 * 864e5)) });
  if (error) throw new Error(`slots: ${error.message}`);
  const slot = ((data ?? []) as { starts_at: string }[]).map((s) => s.starts_at).find((s) => Date.parse(s) >= from.getTime());
  if (!slot) throw new Error("No free slot: is the provider open, with payouts set up, and the Service live with a mode?");
  return new Date(Date.parse(slot)).toISOString();
}
