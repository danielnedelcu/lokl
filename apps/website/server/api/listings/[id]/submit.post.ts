// Submit an Experience for review: draft or rejected -> submitted.
// Whether it's ready is the database's rule (listings_require_ready): a
// refusal comes back from setStatus as a 422 naming what's missing.
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const { supabase, listing } = await loadOwnListing(event, provider);

  if (listing.kind !== "experience") {
    throw createError({ statusCode: 400, statusMessage: "Services are published directly, not sent for review." });
  }
  if (listing.status !== "draft" && listing.status !== "rejected") {
    throw createError({ statusCode: 409, statusMessage: "Only a draft or a listing that needs changes can be submitted." });
  }

  return setStatus(supabase, listing, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
    // Cleared on resubmission (design: rejection_reason).
    rejection_reason: null,
    reviewed_at: null,
  });
});
