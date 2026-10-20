// Send an Experience back: submitted -> rejected, with a reason the
// provider sees in their editor (listings.rejection_reason).
export default defineEventHandler((event) => reviewListing(event, "reject"));
