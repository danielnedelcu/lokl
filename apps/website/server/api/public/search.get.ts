import { z } from "zod";
import type { ListingKind, PublicSearchResult } from "@repo/types";

// GET /api/public/search?market=atlanta[&area=][&from=&to=][&kind=][&category=][&page=]
// The header search's results (docs/design/search.md): one page of the shown
// kind, through the same filtering, paging and visibility rules as browse,
// and both kinds' counts. A category fixes the kind; with none, Experiences
// are shown first. Dates filter Experiences only: Services are counted and
// listed without them (they have no sessions; customers suggest times).
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  market: z.string().regex(/^[a-z0-9-]+$/).max(60),
  kind: z.enum(["service", "experience"]).optional(),
  category: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  area: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
}).refine((q) => !q.category || q.kind, { message: "A category needs its kind." });

export default defineEventHandler(async (event): Promise<PublicSearchResult> => {
  const parsed = query.safeParse(getQuery(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Those filters aren't valid." });
  const q = parsed.data;
  const kind: ListingKind = q.kind ?? "experience";
  const other: ListingKind = kind === "experience" ? "service" : "experience";
  const dates = (k: ListingKind) => (k === "experience" ? { from: q.from, to: q.to } : {});
  const db = usePublicDb(event);
  let shown, otherCount;
  try {
    [shown, otherCount] = await Promise.all([
      browsePublicListings(db, { market: q.market, kind, category: q.category, area: q.area, ...dates(kind), page: q.page }),
      // The other kind's count, for the switch; not needed when a category fixes the kind.
      q.category ? null : browsePublicListings(db, { market: q.market, kind: other, area: q.area, ...dates(other), pageSize: 1 }),
    ]);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!shown) throw createError({ statusCode: 404, statusMessage: "We couldn't find that page." });
  return {
    ...shown,
    counts: { [kind]: shown.total, [other]: otherCount?.total ?? 0 } as Record<ListingKind, number>,
    datesIgnored: kind === "service" && !!(q.from || q.to),
  };
});
