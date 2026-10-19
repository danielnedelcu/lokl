import { z } from "zod";
import { MAX_SEARCH_DAYS, SEARCH_RANGE_TOO_LONG, SEARCH_SECTION_SIZE, searchDays, type ListingKind, type PublicSearchResult } from "@repo/types";

// GET /api/public/search?market=atlanta[&area=][&from=&to=][&kind=][&category=][&page=]
// The header search's results (docs/design/search.md), through browse's own
// filtering, order and visibility rules, with both kinds' counts. No kind is
// the All view: each kind's first SEARCH_SECTION_SIZE results. A kind (or a
// category, which fixes it) is one page of that kind. Dates filter both kinds (a session, or a free time),
// over at most 31 days.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  market: z.string().regex(/^[a-z0-9-]+$/).max(60),
  kind: z.enum(["service", "experience"]).optional(),
  category: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  area: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
}).refine((q) => !q.category || q.kind, { message: "A category needs its kind." })
  .refine((q) => !q.from || !q.to || (q.to >= q.from && searchDays(q.from, q.to) <= MAX_SEARCH_DAYS), { message: SEARCH_RANGE_TOO_LONG });

export default definePublicCachedHandler(["listings", "markets"], async (event): Promise<PublicSearchResult> => {
  const parsed = query.safeParse(getQuery(event));
  if (!parsed.success) {
    // A range that's too long says so; anything else is a bad address.
    const tooLong = parsed.error.issues.some((i) => i.message === SEARCH_RANGE_TOO_LONG);
    throw createError({ statusCode: 400, statusMessage: tooLong ? SEARCH_RANGE_TOO_LONG : "Those filters aren't valid." });
  }
  const q = parsed.data;
  const db = usePublicDb(event);
  const filters = { market: q.market, area: q.area, from: q.from, to: q.to };
  if (!q.kind) {
    let experience, service;
    try {
      [experience, service] = await Promise.all([
        browsePublicListings(db, { ...filters, kind: "experience", pageSize: SEARCH_SECTION_SIZE }),
        browsePublicListings(db, { ...filters, kind: "service", pageSize: SEARCH_SECTION_SIZE }),
      ]);
    } catch (e) {
      throw publicFailure(e);
    }
    if (!experience || !service) throw createError({ statusCode: 404, statusMessage: "We couldn't find that page." });
    return {
      view: "all",
      market: experience.market,
      sections: { experience: { items: experience.items, total: experience.total }, service: { items: service.items, total: service.total } },
      counts: { experience: experience.total, service: service.total },
    };
  }
  const kind: ListingKind = q.kind;
  const other: ListingKind = kind === "experience" ? "service" : "experience";
  let shown, otherCount;
  try {
    [shown, otherCount] = await Promise.all([
      browsePublicListings(db, { ...filters, kind, category: q.category, page: q.page }),
      // The other kind's count, for the switch; not needed when a category fixes the kind.
      q.category ? null : browsePublicListings(db, { ...filters, kind: other, pageSize: 1 }),
    ]);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!shown) throw createError({ statusCode: 404, statusMessage: "We couldn't find that page." });
  return {
    ...shown,
    view: kind,
    counts: { [kind]: shown.total, [other]: otherCount?.total ?? 0 } as Record<ListingKind, number>,
  };
});
