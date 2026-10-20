// Approve an Experience: submitted -> live (design: Listing states). The
// database checks the kind and that nothing blocks it going live
// (admin_set_listing_status, listings_require_ready).
export default defineEventHandler((event) => reviewListing(event, "approve"));
