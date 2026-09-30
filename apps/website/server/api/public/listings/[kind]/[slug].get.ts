import { z } from "zod";

// GET /api/public/listings/:kind/:slug. One visible listing, for its public
// page. Anything not public (draft, in review, taken down, a hidden provider,
// category or market, or no such slug) is the same plain 404.
const params = z.object({
  kind: z.enum(["services", "experiences"]),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120),
});

export default defineEventHandler(async (event) => {
  const parsed = params.safeParse(getRouterParams(event));
  if (!parsed.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that listing." });
  const kind = parsed.data.kind === "services" ? "service" : "experience";
  let listing;
  try {
    listing = await loadPublicListing(usePublicDb(event), kind, parsed.data.slug);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!listing) throw createError({ statusCode: 404, statusMessage: "We couldn't find that listing." });
  return listing;
});
