// Send an Experience back: submitted -> rejected, with a reason the provider
// sees at the top of their editor. They can fix it and submit again.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const reason = await readReason(event);
  const { supabase, listing } = await loadListingForReview(event);

  if (listing.status !== "submitted") {
    throw createError({ statusCode: 409, statusMessage: "Only an Experience in review can be sent back." });
  }

  return setStatus(supabase, listing, { status: "rejected", rejection_reason: reason });
});
