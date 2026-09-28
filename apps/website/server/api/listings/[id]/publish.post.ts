// Publish a Service: draft -> live (design: Listing states). Conditions are
// checked here with the same listingReadiness() the editor shows.
// The photo rule is also enforced by the database (listings_require_photo).
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const { supabase, listing, readiness } = await loadOwnListing(event, provider);

  if (listing.kind !== "service") {
    throw createError({ statusCode: 400, statusMessage: "Experiences are sent for review instead of published." });
  }
  if (listing.status !== "draft") {
    throw createError({ statusCode: 409, statusMessage: "Only a draft can be published." });
  }
  if (!readiness.canAct) {
    throw createError({ statusCode: 422, statusMessage: notReadyMessage(readiness) });
  }

  return setStatus(supabase, listing, {
    status: "live",
    // Set the first time it goes live, and never cleared.
    published_at: listing.published_at ?? new Date().toISOString(),
  });
});
