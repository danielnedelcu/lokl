import { z } from "zod";

// GET /api/public/guides/:market. A market's published guides (the index).
const params = z.object({ market: z.string().regex(/^[a-z0-9-]+$/).max(60) });

export default defineEventHandler(async (event) => {
  const parsed = params.safeParse(getRouterParams(event));
  if (!parsed.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that place." });
  let index;
  try {
    index = await loadPublicGuides(usePublicDb(event), parsed.data.market);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!index) throw createError({ statusCode: 404, statusMessage: "We couldn't find that place." });
  return index;
});
