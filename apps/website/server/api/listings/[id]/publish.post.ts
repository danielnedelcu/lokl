// Publish a Service: draft -> live (design: Listing states).
// Whether it's ready is the database's rule (listings_require_ready): a
// refusal comes back from setStatus as a 422 naming what's missing.
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const { supabase, listing } = await loadOwnListing(event, provider);

  if (listing.kind !== "service") {
    throw createError({ statusCode: 400, statusMessage: "Experiences are sent for review instead of published." });
  }
  if (listing.status !== "draft") {
    throw createError({ statusCode: 409, statusMessage: "Only a draft can be published." });
  }

  return setStatus(supabase, listing, {
    status: "live",
    // Set the first time it goes live, and never cleared.
    published_at: listing.published_at ?? new Date().toISOString(),
  });
});
