// Taking a test listing live the way a real one gets there, for the app
// tests. The listings_require_ready trigger refuses a move into live or
// submitted until the listing is ready (listing_readiness_of): an active
// provider, a photo, the address (an Experience, or a Service at the
// provider's place), a travel area (a Service that travels), and, for
// live, payouts. Against the local stack, with the service role.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

/**
 * Adds what a draft listing is missing (a photo, the address or its own
 * area as the travel area, whichever applies), sends it for review if
 * `submit` (so going live is an approval, which notifies the provider:
 * listing_approved), then moves it live. A provider whose payouts aren't
 * set up is marked ready only for the move and then set back as it was,
 * so each test keeps its provider as it made it. Returns the slug.
 */
export async function goLive(db: SupabaseClient, listingId: string, { submit = true, publishedAt = new Date().toISOString() } = {}): Promise<string> {
  await makeReady(db, listingId);
  if (submit) ok(await db.from("listings").update({ status: "submitted" }).eq("id", listingId), "submit");
  const l = ok(await db.from("listings").select("provider_id").eq("id", listingId).single(), "listing") as { provider_id: string };
  const before = ok(await db.from("providers").select("stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled").eq("id", l.provider_id).single(), "provider") as
    { stripe_account_id: string | null; stripe_charges_enabled: boolean; stripe_payouts_enabled: boolean };
  const ready = before.stripe_account_id !== null && before.stripe_charges_enabled && before.stripe_payouts_enabled;
  if (!ready) {
    ok(await db.from("providers").update({
      stripe_account_id: before.stripe_account_id ?? `acct_test_${l.provider_id.replace(/-/g, "").slice(0, 12)}`,
      stripe_charges_enabled: true, stripe_payouts_enabled: true,
    }).eq("id", l.provider_id), "payouts ready");
  }
  try {
    const row = ok(await db.from("listings").update({ status: "live", published_at: publishedAt }).eq("id", listingId).select("slug").single(), "go live") as { slug: string };
    return row.slug;
  } finally {
    if (!ready) ok(await db.from("providers").update(before).eq("id", l.provider_id), "payouts set back");
  }
}

/** Adds what the listing needs to be sent for review or go live, other than payouts. */
export async function makeReady(db: SupabaseClient, listingId: string) {
  const l = ok(await db.from("listings").select("provider_id, kind, location_mode, area_id").eq("id", listingId).single(), "listing") as
    { provider_id: string; kind: string; location_mode: string | null; area_id: string };
  const has = async (table: string) => {
    const { count, error } = await db.from(table).select("listing_id", { count: "exact", head: true }).eq("listing_id", listingId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (count ?? 0) > 0;
  };
  if (!(await has("listing_photos"))) {
    ok(await db.from("listing_photos").insert({ listing_id: listingId, storage_path: `${l.provider_id}/${listingId}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }), "photo");
  }
  if ((l.kind === "experience" || l.location_mode === "provider_location") && !(await has("listing_addresses"))) {
    ok(await db.from("listing_addresses").insert({ listing_id: listingId, line1: "1 Test Street", city: "Atlanta", state: "GA", postal_code: "30312" }), "address");
  }
  if (l.kind === "service" && l.location_mode === "customer_location" && !(await has("listing_service_areas"))) {
    ok(await db.from("listing_service_areas").insert({ listing_id: listingId, service_area_id: l.area_id }), "travel area");
  }
}
