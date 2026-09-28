// Approve an Experience: submitted -> live (design: Listing states). The
// provider's payouts must be Ready, and the listing complete. The photo rule
// is also enforced by the database (listings_require_photo).
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { supabase, listing, blockers } = await loadListingForReview(event);

  if (listing.kind !== "experience") {
    throw createError({ statusCode: 400, statusMessage: "Only Experiences are reviewed. Services go live when the provider publishes them." });
  }
  if (listing.status !== "submitted") {
    throw createError({ statusCode: 409, statusMessage: "Only an Experience in review can be approved." });
  }
  assertNoBlockers(blockers);

  return setStatus(supabase, listing, {
    status: "live",
    rejection_reason: null,
    // Set the first time it goes live, and never cleared.
    published_at: listing.published_at ?? new Date().toISOString(),
  });
});
