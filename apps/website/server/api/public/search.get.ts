import { z } from "zod";
import { MAX_SEARCH_DAYS, SEARCH_RANGE_TOO_LONG, searchDays, type ListingKind, type PublicSearchResult } from "@repo/types";

// GET /api/public/search?market=atlanta[&area=][&from=&to=][&kind=][&category=][&page=]
// The header search's results (docs/design/search.md): one page of the shown
// kind, through the same filtering, paging and visibility rules as browse,
// and both kinds' counts. A category fixes the kind; with none, Experiences
// are shown first. Dates filter both kinds (a session, or a free time),
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

export default defineEventHandler(async (event): Promise<PublicSearchResult> => {
  const parsed = query.safeParse(getQuery(event));
  if (!parsed.success) {
    // A range that's too long says so; anything else is a bad address.
    const tooLong = parsed.error.issues.some((i) => i.message === SEARCH_RANGE_TOO_LONG);
    throw createError({ statusCode: 400, statusMessage: tooLong ? SEARCH_RANGE_TOO_LONG : "Those filters aren't valid." });
  }
  const q = parsed.data;
  const kind: ListingKind = q.kind ?? "experience";
  const other: ListingKind = kind === "experience" ? "service" : "experience";
  const db = usePublicDb(event);
  let shown, otherCount;
  try {
    [shown, otherCount] = await Promise.all([
      browsePublicListings(db, { market: q.market, kind, category: q.category, area: q.area, from: q.from, to: q.to, page: q.page }),
      // The other kind's count, for the switch; not needed when a category fixes the kind.
      q.category ? null : browsePublicListings(db, { market: q.market, kind: other, area: q.area, from: q.from, to: q.to, pageSize: 1 }),
    ]);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!shown) throw createError({ statusCode: 404, statusMessage: "We couldn't find that page." });
  return {
    ...shown,
    counts: { [kind]: shown.total, [other]: otherCount?.total ?? 0 } as Record<ListingKind, number>,
  };
});
