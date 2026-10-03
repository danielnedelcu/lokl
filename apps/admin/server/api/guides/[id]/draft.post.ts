import Anthropic from "@anthropic-ai/sdk";
import { serverSupabaseServiceRole } from "#supabase/server";
import { aiDraftRequestSchema, type Database } from "@repo/types";

// POST /api/guides/:id/draft { topic, areaId?, categoryId?, notes?, expectedUpdatedAt }:
// asks Claude for a draft and lands it in the guide's draft, marked unreviewed
// (docs/design/destination-guides.md, The AI draft). Admins only. The key is
// server-only runtime config (NUXT_ANTHROPIC_API_KEY), never sent to the page.
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event);
  const request = await readValidatedBody(event, aiDraftRequestSchema.parse);
  const { anthropicApiKey, anthropicModel } = useRuntimeConfig(event);
  if (!anthropicApiKey) {
    throw createError({ statusCode: 503, statusMessage: "AI drafting isn't set up yet: the admin app has no Anthropic key." });
  }
  // Up to 2 minutes for a long draft; the SDK retries brief failures twice.
  const model = new Anthropic({ apiKey: anthropicApiKey, timeout: 120_000, maxRetries: 2 });
  try {
    return await writeGuideDraft(serverSupabaseServiceRole<Database>(event), model, {
      guideId: getRouterParam(event, "id") ?? "",
      adminId: admin.sub,
      modelName: anthropicModel,
      request,
    });
  } catch (e) {
    if (e instanceof GuideDraftError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
