// Take a listing down: live -> unpublished, with a reason the provider sees
// in their editor (listings.unpublished_reason). Only the owner can put it
// back (restore).
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const reason = await readReason(event);
  const { supabase, listing } = await loadListingForReview(event);

  if (listing.status !== "live") {
    throw createError({ statusCode: 409, statusMessage: "Only a live listing can be taken down." });
  }

  return setStatus(supabase, listing, { status: "unpublished", unpublished_reason: reason });
});
