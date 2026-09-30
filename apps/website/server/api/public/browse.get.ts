import { z } from "zod";

// GET /api/public/browse?market=atlanta&kind=experience[&category=][&area=][&from=&to=][&page=]
// A market's visible listings of one kind, filtered and in pages of 24.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  market: z.string().regex(/^[a-z0-9-]+$/).max(60),
  kind: z.enum(["service", "experience"]),
  category: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  area: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export default defineEventHandler(async (event) => {
  const parsed = query.safeParse(getQuery(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Those filters aren't valid." });
  let result;
  try {
    result = await browsePublicListings(usePublicDb(event), parsed.data);
  } catch (e) {
    throw publicFailure(e);
  }
  if (!result) throw createError({ statusCode: 404, statusMessage: "We couldn't find that page." });
  return result;
});
