import { z } from "zod";

// GET /api/public/reviews?listing=<id> or ?provider=<id>, &page=n: a
// listing's or provider's published reviews, newest first, 10 a page, as a
// visitor reads them (docs/design/reviews.md). Not cached: a new review or
// a removal shows at once.
const query = z.union([
  z.object({ listing: z.uuid(), page: z.coerce.number().int().min(1).max(1000).default(1) }),
  z.object({ provider: z.uuid(), page: z.coerce.number().int().min(1).max(1000).default(1) }),
]);

export default defineEventHandler(async (event) => {
  const parsed = query.safeParse(getQuery(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Ask for a listing's or a provider's reviews." });
  const q = parsed.data;
  try {
    return await loadPublicReviews(usePublicDb(event), "listing" in q ? { listingId: q.listing } : { providerId: q.provider }, q.page);
  } catch (e) {
    throw publicFailure(e);
  }
});
