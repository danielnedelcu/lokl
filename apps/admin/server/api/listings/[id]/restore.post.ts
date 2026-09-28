// Put a taken-down listing back: unpublished -> live, under the same
// conditions as its original publish (Service) or approval (Experience).
// The reason is cleared; the database requires it (listings_unpublished_reason).
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { supabase, listing, blockers } = await loadListingForReview(event);

  if (listing.status !== "unpublished") {
    throw createError({ statusCode: 409, statusMessage: "Only a taken-down listing can be restored." });
  }
  assertNoBlockers(blockers);

  return setStatus(supabase, listing, { status: "live", unpublished_reason: null });
});
