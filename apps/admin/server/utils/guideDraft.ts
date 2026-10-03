import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AI_DRAFT_RUNNING_MS,
  AI_DRAFTS_PER_HOUR,
  findStalePhrases,
  guideBodySchema,
  guideSlugSchema,
  GUIDE_TEASER_MAX,
  GUIDE_TITLE_MAX,
  type AiDraftRequest,
  type Database,
  type Json,
} from "@repo/types";
import { GUIDE_DRAFT_SCHEMA, guideWriterSystemPrompt, guideWriterUserMessage } from "../prompts/guide-writer";

// AI drafts of destination guides (docs/design/destination-guides.md, The
// AI draft). One request: check the guide and the limits, log the request,
// ask the model, check its reply, and land it in the draft (marked
// unreviewed) only if everything is valid and the guide hasn't changed.
// Every request is logged in guide_ai_drafts, whatever happens.

/** The part of the Anthropic client this uses, so tests can pass a fake. */
export interface DraftModel {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

/** Dollars per million tokens (Anthropic's pricing page, checked 2026-10-03). */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
};

export class GuideDraftError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Db = SupabaseClient<Database>;

const MESSAGES = {
  notFound: "We couldn't find that guide.",
  changed: "This guide changed while the draft was being written. Reload, then try again.",
  changedBefore: "This guide has changed since you opened it. Reload, then try again.",
  running: "A draft for this guide is already being written. Wait for it to finish.",
  cap: `That's ${AI_DRAFTS_PER_HOUR} AI drafts in the last hour. Try again later.`,
  incomplete: "The draft came back incomplete, so nothing was changed. Try again, perhaps with a narrower subject.",
  key: "The AI service refused lokl's key. Check it in the Anthropic console.",
  limit: "lokl's AI spending or rate limit has been reached. Try again later, or check the limit in the Anthropic console.",
  slow: "The AI service didn't answer in time. Try again in a minute.",
  failed: "The AI draft didn't work. Try again, or check the server logs.",
};

// ---------------------------------------------------------------------------
// The reply, and turning it into the editor's blocks
// ---------------------------------------------------------------------------

const replySchema = z.object({
  title: z.string().trim().min(3),
  teaser: z.string().trim().min(20),
  slug: z.string(),
  body: z
    .array(
      z.object({
        type: z.enum(["paragraph", "heading", "subheading", "list"]),
        text: z.string(),
        items: z.array(z.string()),
        ordered: z.boolean(),
      }),
    )
    .min(3)
    .max(80),
});
export type DraftReply = z.infer<typeof replySchema>;

// The model writes plain text; the body stores inline HTML, so escape it.
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const blockId = () => randomBytes(5).toString("hex");

/** Cut at the last whole word that fits. */
export function fitWords(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, "");
  return (cut || t.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

/** The editor's blocks for a reply, or null if they wouldn't pass the body's schema. */
export function replyToBody(reply: DraftReply) {
  const blocks = reply.body.flatMap((b): Record<string, unknown>[] => {
    const text = b.text.trim();
    if (b.type === "list") {
      const items = b.items.map((i) => i.trim()).filter(Boolean);
      return items.length
        ? [{ id: blockId(), type: "list", data: { style: b.ordered ? "ordered" : "unordered", meta: b.ordered ? { counterType: "numeric" } : {}, items: items.map((i) => ({ content: escape(i), meta: {}, items: [] })) } }]
        : [];
    }
    if (!text) return [];
    if (b.type === "paragraph") return [{ id: blockId(), type: "paragraph", data: { text: escape(text) } }];
    return [{ id: blockId(), type: "header", data: { text: escape(text), level: b.type === "heading" ? 2 : 3 } }];
  });
  const parsed = guideBodySchema.safeParse({ blocks });
  return parsed.success && parsed.data.blocks.length >= 3 ? parsed.data : null;
}

/** Every plain-text piece of a reply, for the stale-phrase count. */
function replyTexts(r: DraftReply) {
  return [r.title, r.teaser, ...r.body.flatMap((b) => (b.type === "list" ? b.items : [b.text]))];
}

export function costUsd(model: string, usage: { input_tokens: number; output_tokens: number }): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return Math.round(((usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000) * 10_000) / 10_000;
}

/** A plain message for a failed call, and whether it's worth trying again later. */
export function modelErrorMessage(e: unknown): { status: number; message: string } {
  const status = (e as { status?: number }).status;
  const name = (e as Error)?.constructor?.name ?? "";
  if (status === 401 || status === 403) return { status: 502, message: MESSAGES.key };
  if (status === 429) return { status: 429, message: MESSAGES.limit };
  if (name.includes("Timeout") || name.includes("Connection") || status === 529 || (status ?? 0) >= 500) return { status: 503, message: MESSAGES.slow };
  return { status: 502, message: MESSAGES.failed };
}

// ---------------------------------------------------------------------------
// Writing a draft
// ---------------------------------------------------------------------------

export interface DraftResult {
  guide: Database["public"]["Tables"]["guides"]["Row"];
  logId: string;
  suggestedSlug: string | null;
  phrases: number;
  costUsd: number | null;
}

export async function writeGuideDraft(
  db: Db,
  model: DraftModel,
  opts: { guideId: string; adminId: string; modelName: string; request: AiDraftRequest },
): Promise<DraftResult> {
  const { guideId, adminId, modelName, request: req } = opts;
  if (!z.uuid().safeParse(guideId).success) throw new GuideDraftError(404, MESSAGES.notFound);

  const { data: guide, error: gErr } = await db.from("guides").select("*, market:cities(name)").eq("id", guideId).maybeSingle();
  if (gErr) throw failure("load guide", gErr);
  if (!guide) throw new GuideDraftError(404, MESSAGES.notFound);
  // Nothing is spent on a guide that has already moved on.
  if (guide.updated_at !== req.expectedUpdatedAt) throw new GuideDraftError(409, MESSAGES.changedBefore);

  const [area, category] = await Promise.all([
    req.areaId ? db.from("service_areas").select("name, kind, city_id").eq("id", req.areaId).maybeSingle() : null,
    req.categoryId ? db.from("categories").select("name, kind").eq("id", req.categoryId).maybeSingle() : null,
  ]);
  if (area?.error || category?.error) throw failure("load area or category", area?.error ?? category?.error);
  if (req.areaId && (!area?.data || area.data.city_id !== guide.market_id)) throw new GuideDraftError(400, "That area isn't in this guide's city.");
  if (req.categoryId && !category?.data) throw new GuideDraftError(400, "We couldn't find that category.");

  // The limits: one draft at a time per guide, and an hourly cap overall.
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: cErr } = await db.from("guide_ai_drafts").select("id", { count: "exact", head: true }).gt("created_at", hourAgo);
  if (cErr) throw failure("count drafts", cErr);
  if ((count ?? 0) >= AI_DRAFTS_PER_HOUR) throw new GuideDraftError(429, MESSAGES.cap);
  const runningSince = new Date(Date.now() - AI_DRAFT_RUNNING_MS).toISOString();
  const { data: running, error: rErr } = await db
    .from("guide_ai_drafts")
    .select("id")
    .eq("guide_id", guideId)
    .is("reply", null)
    .is("error", null)
    .gt("created_at", runningSince)
    .limit(1);
  if (rErr) throw failure("check running drafts", rErr);
  if (running.length) throw new GuideDraftError(409, MESSAGES.running);

  // Logged before the call, so a second request sees this one running.
  // The log keeps the brief whole in `notes`, and its first line (up to 200
  // characters) in `topic`, as the label for the draft.
  const brief = req.brief.trim();
  const label = brief.split("\n")[0]!.trim().slice(0, 200);
  const { data: log, error: lErr } = await db
    .from("guide_ai_drafts")
    .insert({
      guide_id: guideId,
      requested_by: adminId,
      topic: label,
      area_id: req.areaId ?? null,
      category_id: req.categoryId ?? null,
      notes: brief,
      model: modelName,
    })
    .select("id")
    .single();
  if (lErr) throw failure("log draft", lErr);
  const finish = async (fields: Database["public"]["Tables"]["guide_ai_drafts"]["Update"]) => {
    const { error } = await db.from("guide_ai_drafts").update(fields).eq("id", log.id);
    if (error) console.error("[admin api] couldn't update the AI draft log", error);
  };
  const fail = async (status: number, message: string, detail: string, usage?: Anthropic.Usage, reply?: Json) => {
    await finish({
      error: detail.slice(0, 1000),
      reply: reply ?? null,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cost_usd: usage ? costUsd(modelName, usage) : null,
    });
    return new GuideDraftError(status, message);
  };

  // The call.
  const market = (guide as unknown as { market: { name: string } | null }).market?.name ?? "the city";
  let message: Anthropic.Message;
  try {
    message = await model.messages.create({
      model: modelName,
      max_tokens: 8000,
      system: guideWriterSystemPrompt(market),
      messages: [
        {
          role: "user",
          content: guideWriterUserMessage({
            market,
            area: area?.data ? { name: area.data.name, kind: area.data.kind } : null,
            category: category?.data ? { name: category.data.name, kind: category.data.kind as "service" | "experience" } : null,
            kind: req.categoryId ? null : (guide.draft_listing_kind as "service" | "experience" | null),
            brief,
          }),
        },
      ],
      output_config: { format: { type: "json_schema", schema: GUIDE_DRAFT_SCHEMA as unknown as Record<string, unknown> } },
    });
  } catch (e) {
    const { status, message: text } = modelErrorMessage(e);
    // The SDK's message, never its request headers (which hold the key).
    console.error("[admin api] AI draft call failed", (e as { status?: number }).status, (e as Error).message);
    throw await fail(status, text, `${(e as { status?: number }).status ?? ""} ${(e as Error).message}`.trim());
  }

  // The reply: complete, in shape, and turnable into blocks, or nothing lands.
  const usage = message.usage;
  const raw = message.content.find((c) => c.type === "text")?.text ?? "";
  if (message.stop_reason !== "end_turn") {
    throw await fail(502, MESSAGES.incomplete, `Stopped early: ${message.stop_reason}`, usage, { stop_reason: message.stop_reason, text: raw.slice(0, 4000) });
  }
  let reply: DraftReply;
  try {
    reply = replySchema.parse(JSON.parse(raw));
  } catch (e) {
    throw await fail(502, MESSAGES.incomplete, `Reply not in shape: ${(e as Error).message}`, usage, { text: raw.slice(0, 4000) });
  }
  const body = replyToBody(reply);
  if (!body) throw await fail(502, MESSAGES.incomplete, "Reply body couldn't be turned into blocks", usage, reply as unknown as Json);

  const title = fitWords(reply.title, GUIDE_TITLE_MAX);
  const teaser = fitWords(reply.teaser, GUIDE_TEASER_MAX);
  const slug = guideSlugSchema.safeParse(reply.slug.trim().toLowerCase().slice(0, 80).replace(/-+$/, ""));
  const phrases = replyTexts(reply).reduce((n, t) => n + findStalePhrases(t).length, 0);

  // Land it: only if the guide is as the editor last saw it.
  const previous = {
    title: guide.draft_title,
    teaser: guide.draft_teaser,
    body: guide.draft_body,
    area_id: guide.draft_area_id,
    category_id: guide.draft_category_id,
    listing_kind: guide.draft_listing_kind,
    pending_review: guide.ai_draft_pending_review,
    reviewed_by: guide.ai_reviewed_by,
    reviewed_at: guide.ai_reviewed_at,
  };
  const { data: landed, error: wErr } = await db
    .from("guides")
    .update({
      draft_title: title,
      draft_teaser: teaser,
      draft_body: body as unknown as Json,
      draft_area_id: req.areaId ?? null,
      draft_category_id: req.categoryId ?? null,
      // A category belongs to one kind; otherwise the draft's choice stays.
      draft_listing_kind: req.categoryId ? null : guide.draft_listing_kind,
      ai_draft_pending_review: true,
      ai_reviewed_by: null,
      ai_reviewed_at: null,
    })
    .eq("id", guideId)
    .eq("updated_at", req.expectedUpdatedAt)
    .select("*");
  const loggedReply = { ...reply, title, teaser, phrases } as unknown as Json;
  if (wErr) {
    console.error("[admin api] AI draft didn't land", wErr);
    throw await fail(500, MESSAGES.failed, `Not applied: ${wErr.message}`, usage, loggedReply);
  }
  if (!landed.length) throw await fail(409, MESSAGES.changed, "Not applied: the guide changed while the draft was being written", usage, loggedReply);

  const cost = costUsd(modelName, usage);
  await finish({
    reply: loggedReply,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: cost,
    previous_draft: previous as unknown as Json,
  });
  return { guide: landed[0]!, logId: log.id, suggestedSlug: slug.success ? slug.data : null, phrases, costUsd: cost };
}

// ---------------------------------------------------------------------------
// Undo: put back the draft from before the latest AI draft
// ---------------------------------------------------------------------------

export async function restorePreviousDraft(db: Db, opts: { guideId: string; logId: string; expectedUpdatedAt: string }) {
  const { guideId, logId, expectedUpdatedAt } = opts;
  if (!z.uuid().safeParse(guideId).success || !z.uuid().safeParse(logId).success) throw new GuideDraftError(404, MESSAGES.notFound);
  // Only the latest AI draft that landed, and only once.
  const { data: latest, error } = await db
    .from("guide_ai_drafts")
    .select("id, previous_draft, previous_draft_restored_at")
    .eq("guide_id", guideId)
    .not("previous_draft", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw failure("load AI draft", error);
  if (!latest || latest.id !== logId || latest.previous_draft_restored_at) {
    throw new GuideDraftError(409, "Only the latest AI draft can be undone, and only once.");
  }
  const p = latest.previous_draft as {
    title: string; teaser: string; body: Json; area_id: string | null; category_id: string | null;
    listing_kind: string | null; pending_review: boolean; reviewed_by: string | null; reviewed_at: string | null;
  };
  const { data: rows, error: wErr } = await db
    .from("guides")
    .update({
      draft_title: p.title,
      draft_teaser: p.teaser,
      draft_body: p.body,
      draft_area_id: p.area_id,
      draft_category_id: p.category_id,
      draft_listing_kind: p.listing_kind,
      // Back to how it was: unreviewed only if the draft before was an unreviewed AI draft.
      ai_draft_pending_review: p.pending_review,
      ai_reviewed_by: p.reviewed_by,
      ai_reviewed_at: p.reviewed_at,
    })
    .eq("id", guideId)
    .eq("updated_at", expectedUpdatedAt)
    .select("*");
  if (wErr) throw failure("restore draft", wErr);
  if (!rows.length) throw new GuideDraftError(409, MESSAGES.changedBefore);
  const { error: mErr } = await db.from("guide_ai_drafts").update({ previous_draft_restored_at: new Date().toISOString() }).eq("id", logId);
  if (mErr) console.error("[admin api] couldn't mark the previous draft restored", mErr);
  return { guide: rows[0]! };
}

function failure(what: string, error: unknown) {
  console.error(`[admin api] AI draft: couldn't ${what}`, error);
  return new GuideDraftError(500, "Something went wrong on our side. Try again, or check the server logs.");
}
