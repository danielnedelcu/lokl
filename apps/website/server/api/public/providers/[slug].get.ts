import { z } from "zod";

// GET /api/public/providers/:slug. A provider's public profile and their
// visible listings (docs/design/provider-profiles.md). A suspended provider,
// or one with no visible listing, is not found.
const params = z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(70) });

export default defineEventHandler(async (event) => {
  const parsed = params.safeParse(getRouterParams(event));
  if (!parsed.success) throw createError({ statusCode: 404, statusMessage: "We couldn't find that provider." });
  let found;
  try {
    found = await loadPublicProvider(usePublicDb(event), parsed.data.slug);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!found) throw createError({ statusCode: 404, statusMessage: "We couldn't find that provider." });
  return found;
});
