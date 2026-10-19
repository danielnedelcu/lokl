import { z } from "zod";

// GET /api/public/homepage-listings?market=atlanta. The two listings in the
// homepage's "On lokl now": one Experience and one Service, each chosen at
// random from the visible ones (pickPublicListing), or null for a kind with
// none. Chosen here, on the server, and kept for a minute unless a listing changes (publicCache.ts),
// so the page renders the same cards on the server and in the browser.
const query = z.object({ market: z.string().regex(/^[a-z0-9-]+$/).max(60) });

export default definePublicCachedHandler(["listings", "markets"], async (event) => {
  const parsed = query.safeParse(getQuery(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "That market isn't valid." });
  try {
    const db = usePublicDb(event);
    const [experience, service] = await Promise.all([
      pickPublicListing(db, parsed.data.market, "experience"),
      pickPublicListing(db, parsed.data.market, "service"),
    ]);
    return { market: experience.market ?? service.market, experience: experience.card, service: service.card };
  } catch (e) {
    throw publicFailure(e);
  }
});
