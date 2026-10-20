// Take a listing down: live -> unpublished, with a reason the provider sees
// in their editor (listings.unpublished_reason). Support taking one down
// alerts every owner (admin_set_listing_status).
export default defineEventHandler((event) => reviewListing(event, "unpublish"));
