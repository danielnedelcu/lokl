// Put a listing back: unpublished -> live, once nothing blocks it going
// live (listings_require_ready).
export default defineEventHandler((event) => reviewListing(event, "restore"));
