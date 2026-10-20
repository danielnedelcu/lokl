import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Listing, Provider } from "@repo/types";
import { serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

// Loads one of the signed-in provider's listings with the server key. A
// listing that isn't theirs is reported as not found. Whether it's ready to
// publish or submit is the database's to say (listing_readiness(), enforced
// by the listings_require_ready trigger): setStatus passes its refusal on.
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
  return { supabase, listing: listing as Listing };
}

// Updates the status only if it's still what was checked, so two clicks at
// once can't both succeed. Returns the updated listing.
export async function setStatus(
  supabase: SupabaseClient<Database>,
  listing: Listing,
  update: Database["public"]["Tables"]["listings"]["Update"],
) {
  const { data, error } = await supabase
    .from("listings")
    .update(update)
    .eq("id", listing.id)
    .eq("status", listing.status)
    .select("*")
    .maybeSingle();
  // The database's readiness refusal names what's missing, in the checklist's words.
  if (error?.code === "23514") throw createError({ statusCode: 422, statusMessage: error.message });
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  if (!data) throw createError({ statusCode: 409, statusMessage: "This listing changed in the meantime. Reload the page and try again." });
  return data as Listing;
}
