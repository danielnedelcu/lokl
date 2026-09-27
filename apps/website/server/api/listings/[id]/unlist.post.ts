// Unlist: live or submitted -> draft. The listing leaves the public site or
// the review queue; published_at is kept.
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const { supabase, listing } = await loadOwnListing(event, provider);

  if (listing.status !== "live" && listing.status !== "submitted") {
    throw createError({ statusCode: 409, statusMessage: "Only a live or submitted listing can be unlisted." });
  }

  return setStatus(supabase, listing, { status: "draft" });
});
