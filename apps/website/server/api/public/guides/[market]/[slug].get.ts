import { z } from "zod";

// GET /api/public/guides/:market/:slug. One published guide (its live copy)
// with its listings block. Drafts and unpublished guides are not found.
const params = z.object({
  market: z.string().regex(/^[a-z0-9-]+$/).max(60),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80),
});

export default defineEventHandler(async (event) => {
  const parsed = params.safeParse(getRouterParams(event));
  if (!parsed.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that guide." });
  let found;
  try {
    found = await loadPublicGuide(usePublicDb(event), parsed.data.market, parsed.data.slug);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!found) throw createError({ statusCode: 404, statusMessage: "We couldn't find that guide." });
  return found;
});
