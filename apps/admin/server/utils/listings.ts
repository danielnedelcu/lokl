import type { H3Event } from "h3";
import { serverSupabaseServiceRole } from "#supabase/server";
import { listingReasonSchema, reviewBlockers, type Listing, type Provider } from "@repo/types";

// A database failure: the detail goes to the server log, the admin sees a
// plain message.
function serverFailure(error: unknown) {
  console.error("[admin api] listing review query failed", error);
  return createError({ statusCode: 500, statusMessage: "Something went wrong on our side. Try again, or check the server logs." });
}

// Loads a listing with the server key, plus what reviewBlockers() needs: the
// same facts the provider's editor checklist uses. Call after requireAdmin.
export async function loadListingForReview(event: H3Event) {
  const id = getRouterParam(event, "id");
  const supabase = serverSupabaseServiceRole(event);

  const { data: listing, error } = await supabase.from("listings").select("*").eq("id", id!).maybeSingle();
  if (error) throw serverFailure(error);
  if (!listing) throw createError({ statusCode: 404, statusMessage: "We couldn't find that listing." });
  const l = listing as Listing;

  const [provider, address, travel, photos, sessions] = await Promise.all([
    supabase.from("providers").select("*").eq("id", l.provider_id).single(),
    supabase.from("listing_addresses").select("listing_id").eq("listing_id", l.id).maybeSingle(),
    supabase.from("listing_service_areas").select("service_area_id", { count: "exact", head: true }).eq("listing_id", l.id),
    supabase.from("listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", l.id),
    supabase.from("experience_sessions").select("id", { count: "exact", head: true })
      .eq("listing_id", l.id).eq("status", "scheduled").gt("starts_at", new Date().toISOString()),
  ]);
  for (const r of [provider, address, travel, photos, sessions]) {
    if (r.error) throw serverFailure(r.error);
  }
  const p = provider.data as Provider;

  const blockers = reviewBlockers({
    kind: l.kind,
    status: l.status,
    locationMode: l.location_mode,
    hasAddress: !!address.data,
    travelAreaCount: travel.count ?? 0,
    photoCount: photos.count ?? 0,
    upcomingSessionCount: sessions.count ?? 0,
    providerActive: p.status === "active",
    payoutsReady: !!(p.stripe_charges_enabled && p.stripe_payouts_enabled),
  });
  return { supabase, listing: l, blockers };
}

// Refuses with the list of what's missing, in the admin's words.
export function assertNoBlockers(blockers: string[]) {
  if (blockers.length) {
    throw createError({ statusCode: 422, statusMessage: `It can't go live yet: ${blockers.join("; ")}.` });
  }
}

// Updates the status only if it's still what was checked, so two clicks at
// once can't both succeed (same as the website's setStatus). Returns the
// updated listing.
export async function setStatus(
  supabase: ReturnType<typeof serverSupabaseServiceRole>,
  listing: Listing,
  update: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("listings")
    .update({ ...update, reviewed_at: new Date().toISOString() })
    .eq("id", listing.id)
    .eq("status", listing.status)
    .select("*")
    .maybeSingle();
  if (error) throw serverFailure(error);
  if (!data) throw createError({ statusCode: 409, statusMessage: "This listing changed in the meantime. Reload the page and try again." });
  return data as Listing;
}

// The reason sent with a rejection or unpublish (listingReasonSchema); the
// provider sees it.
export async function readReason(event: H3Event) {
  const parsed = listingReasonSchema.safeParse(await readBody(event).catch(() => null));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? "A reason is required." });
  }
  return parsed.data.reason;
}
