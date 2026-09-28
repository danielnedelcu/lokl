import { listingReadiness, payoutSetupOf, type Listing, type Provider } from "@repo/types";
import { serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

// Loads one of the signed-in provider's listings with the server key, plus
// what readiness needs, and runs the same listingReadiness() as the editor.
// A listing that isn't theirs is reported as not found.
export async function loadOwnListing(event: ServerEvent, provider: Provider) {
  const id = getRouterParam(event, "id");
  const supabase = serverSupabaseServiceRole(event);

  const { data: listing, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id!)
    .eq("provider_id", provider.id)
    .maybeSingle();
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  if (!listing) throw createError({ statusCode: 404, statusMessage: "We couldn't find that listing." });

  const [address, travel, photos] = await Promise.all([
    supabase.from("listing_addresses").select("listing_id").eq("listing_id", listing.id).maybeSingle(),
    supabase.from("listing_service_areas").select("service_area_id", { count: "exact", head: true }).eq("listing_id", listing.id),
    supabase.from("listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listing.id),
  ]);
  for (const r of [address, travel, photos]) {
    if (r.error) throw createError({ statusCode: 500, statusMessage: r.error.message });
  }

  const l = listing as Listing;
  const readiness = listingReadiness({
    kind: l.kind,
    status: l.status,
    locationMode: l.location_mode,
    hasAddress: !!address.data,
    travelAreaCount: travel.count ?? 0,
    photoCount: photos.count ?? 0,
    providerActive: provider.status === "active",
    payoutsReady: payoutSetupOf(provider) === "ready",
  });
  return { supabase, listing: l, readiness };
}

// A plain-language reason the action is blocked, naming what's left to do.
export function notReadyMessage(readiness: ReturnType<typeof listingReadiness>): string {
  const todo = readiness.items.filter((i) => i.blocking && !i.done).map((i) => i.label.toLowerCase());
  return todo.length ? `Before you can do that: ${todo.join("; ")}.` : "This listing can't be changed that way right now.";
}

// Updates the status only if it's still what was checked, so two clicks at
// once can't both succeed. Returns the updated listing.
export async function setStatus(
  supabase: ReturnType<typeof serverSupabaseServiceRole>,
  listing: Listing,
  update: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("listings")
    .update(update)
    .eq("id", listing.id)
    .eq("status", listing.status)
    .select("*")
    .maybeSingle();
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  if (!data) throw createError({ statusCode: 409, statusMessage: "This listing changed in the meantime. Reload the page and try again." });
  return data as Listing;
}
