import { z } from "zod";

// GET /api/public/markets/:slug. A public market with its categories (and how
// many visible listings each has) and areas, for filters and the market page.
const params = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/).max(60) });

export default defineEventHandler(async (event) => {
  const parsed = params.safeParse(getRouterParams(event));
  if (!parsed.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that place." });
  let market;
  try {
    market = await loadPublicMarket(usePublicDb(event), parsed.data.slug);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!market) throw createError({ statusCode: 404, statusMessage: "We couldn't find that place." });
  return market;
});
