import { z } from "zod";

// POST /api/admin/guide-listings { marketId, areaId?, categoryId?, kind? }:
// the listings a guide's block would show right now, as a signed-out visitor
// sees them. For the guide editor's preview. Admin app only.
const body = z.object({
  marketId: z.uuid(),
  areaId: z.uuid().nullish(),
  categoryId: z.uuid().nullish(),
  kind: z.enum(["service", "experience"]).nullish(),
});

export default defineEventHandler(async (event) => {
  await requireAdminRequest(event);
  const q = await readValidatedBody(event, body.parse);
  try {
    return await guideListings(usePublicDb(event), q);
  } catch (e) {
    throw publicFailure(e);
  }
});
