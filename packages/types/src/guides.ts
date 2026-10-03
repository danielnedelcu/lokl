import { z } from "zod";
import type { Tables } from "./database";

// Destination guides (docs/design/destination-guides.md). The database is
// the enforcement layer (publish_guide() and the table checks); these are
// the same rules for the editor, so it can say what's missing before the
// database refuses.

export type Guide = Tables<"guides">;
export type GuidePhoto = Tables<"guide_photos">;
export type GuideVersion = Tables<"guide_versions">;

export const GUIDE_TITLE_MAX = 120;
export const GUIDE_TEASER_MIN = 20;
export const GUIDE_TEASER_MAX = 160;
export const GUIDE_SLUG_MAX = 80;
/** The cover's minimum size, landscape (lowered from 2,000 × 1,125 on 2026-10-03). Body photos have none. */
export const GUIDE_COVER_MIN = { width: 1600, height: 900 } as const;
export const GUIDE_PHOTO_MAX_SIDE = 2400;
export const GUIDE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const GUIDE_PHOTO_BUCKET = "guide-photos";

// ---------------------------------------------------------------------------
// The body: Editor.js blocks, checked before every save. Inline text is the
// HTML Editor.js produces; lokl's renderer (packages/ui GuideBody) draws it
// with only bold, italic and links allowed, and escapes everything else.
// ---------------------------------------------------------------------------

const text = z.string().max(20_000);
const listItem: z.ZodType<{ content: string; items: unknown[] }> = z.lazy(() =>
  z.object({ content: text, meta: z.record(z.string(), z.unknown()).optional(), items: z.array(listItem).max(0, "Lists can't be nested.") }),
);

export const guideBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().optional(), type: z.literal("paragraph"), data: z.object({ text }) }),
  // Levels 2 and 3 only: the guide's title is the page's main heading.
  z.object({
    id: z.string().optional(),
    type: z.literal("header"),
    data: z.object({ text, level: z.union([z.literal(2), z.literal(3)], { error: "Headings are level 2 or 3." }) }),
  }),
  z.object({
    id: z.string().optional(),
    type: z.literal("list"),
    // A checklist is drawn as a plain bulleted list.
    data: z.object({ style: z.enum(["ordered", "unordered", "checklist"]), meta: z.record(z.string(), z.unknown()).optional(), items: z.array(listItem).min(1) }),
  }),
  z.object({
    id: z.string().optional(),
    type: z.literal("quote"),
    data: z.object({ text, caption: text.optional(), alignment: z.string().optional() }),
  }),
  // One of the guide's own photos, by id: alt text and credit always come
  // from its guide_photos row, never from the body.
  z.object({
    id: z.string().optional(),
    type: z.literal("photo"),
    data: z.object({ photoId: z.uuid("Choose a photo for each photo block."), caption: z.string().max(300).optional() }),
  }),
]);
export type GuideBlock = z.infer<typeof guideBlockSchema>;

export const guideBodySchema = z.object({ blocks: z.array(guideBlockSchema).max(500) });
export type GuideBody = z.infer<typeof guideBodySchema>;

/** The photo ids a body uses (photo blocks). */
export function bodyPhotoIds(body: unknown): Set<string> {
  const blocks = (body as { blocks?: { type?: string; data?: { photoId?: unknown } }[] } | null)?.blocks ?? [];
  return new Set(blocks.filter((b) => b?.type === "photo" && typeof b.data?.photoId === "string").map((b) => b.data!.photoId as string));
}

// ---------------------------------------------------------------------------
// Slug, title, teaser
// ---------------------------------------------------------------------------

export const guideSlugSchema = z
  .string()
  .trim()
  .min(1, "Enter a web address.")
  .max(GUIDE_SLUG_MAX, `Keep the web address under ${GUIDE_SLUG_MAX} characters.`)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, like old-fourth-ward-food.");

export const newGuideSchema = z.object({
  title: z.string().trim().min(3, "Enter a title of at least 3 characters.").max(GUIDE_TITLE_MAX, `Keep the title under ${GUIDE_TITLE_MAX} characters.`),
  slug: guideSlugSchema,
});

// ---------------------------------------------------------------------------
// Publishing: the same checks, in the same order and words, as publish_guide()
// ---------------------------------------------------------------------------

/** Why a photo can't be a cover, or null if it can. */
export function coverSizeProblem(photo: { width: number; height: number }): string | null {
  const { width, height } = photo;
  if (width >= GUIDE_COVER_MIN.width && height >= GUIDE_COVER_MIN.height && width > height) return null;
  return `The cover photo needs to be landscape and at least 1,600 by 900 pixels (this one is ${width} by ${height}).`;
}

export type GuideDraftFields = Pick<
  Guide,
  "draft_title" | "draft_teaser" | "draft_body" | "draft_area_id" | "draft_category_id" | "ai_draft_pending_review"
>;

/** What still stops a guide's draft being published; empty when it can be. */
export function guidePublishBlockers(g: GuideDraftFields, cover: { width: number; height: number } | null): string[] {
  const blockers: string[] = [];
  if (g.draft_title.trim().length < 3) blockers.push("Add a title.");
  if (g.draft_teaser.trim().length < GUIDE_TEASER_MIN) {
    blockers.push("Add a teaser of at least 20 characters. It shows under the photo and in search results.");
  }
  const blocks = (g.draft_body as { blocks?: unknown[] } | null)?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) blockers.push("Write the guide before publishing it.");
  if (!g.draft_area_id && !g.draft_category_id) {
    blockers.push("Choose an area or a category, so the guide can show matching listings.");
  }
  if (g.ai_draft_pending_review) {
    blockers.push("This AI draft hasn't been reviewed yet. Check the highlighted phrases and the facts, then mark it reviewed.");
  }
  if (!cover) blockers.push("Add a cover photo.");
  else {
    const problem = coverSizeProblem(cover);
    if (problem) blockers.push(problem);
  }
  return blockers;
}

/** Where a guide stands, comparing its draft with its live copy. */
export type GuideState = "draft" | "published" | "changes" | "unpublished";

const DRAFT_TO_LIVE = [
  ["draft_title", "title"],
  ["draft_teaser", "teaser"],
  ["draft_body", "body"],
  ["draft_cover_photo_id", "cover_photo_id"],
  ["draft_area_id", "area_id"],
  ["draft_category_id", "category_id"],
  ["draft_listing_kind", "listing_kind"],
] as const;

/** True when the draft differs from what's live. Both bodies come out of jsonb, so their key order matches. */
export function guideHasUnpublishedChanges(g: Pick<Guide, (typeof DRAFT_TO_LIVE)[number][number]>): boolean {
  return DRAFT_TO_LIVE.some(([d, l]) => JSON.stringify(g[d] ?? null) !== JSON.stringify(g[l] ?? null));
}

export function guideState(g: Pick<Guide, "status" | (typeof DRAFT_TO_LIVE)[number][number]>): GuideState {
  if (g.status === "draft") return "draft";
  if (g.status === "unpublished") return "unpublished";
  return guideHasUnpublishedChanges(g) ? "changes" : "published";
}

// ---------------------------------------------------------------------------
// Photos and credits
// ---------------------------------------------------------------------------

export const GUIDE_PHOTO_SOURCES = ["own", "unsplash", "other"] as const;
export type GuidePhotoSource = (typeof GUIDE_PHOTO_SOURCES)[number];

const https = (message: string) => z.string().trim().regex(/^https:\/\/\S+$/, message);
const optionalText = (max: number, message: string) => z.string().trim().max(max, message).optional().or(z.literal(""));

/** The photo details form; the database's credit checks, with plain messages. */
export const guidePhotoDetailsSchema = z
  .object({
    alt_text: z.string().trim().min(5, "Describe the photo in at least 5 characters.").max(200, "Keep the description under 200 characters."),
    source: z.enum(GUIDE_PHOTO_SOURCES),
    credit_name: optionalText(120, "Keep the credit under 120 characters."),
    credit_url: z.string().trim().optional().or(z.literal("")),
    source_url: z.string().trim().optional().or(z.literal("")),
    licence: optionalText(120, "Keep the licence name under 120 characters."),
    commercial_use_confirmed: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const need = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const check = (path: "credit_url" | "source_url", schema: z.ZodType) => {
      const value = v[path];
      if (value && !schema.safeParse(value).success) {
        need(path, (schema.safeParse(value).error?.issues[0]?.message) ?? "Check this address.");
      }
    };
    if (v.source === "unsplash") {
      if (!v.credit_name) need("credit_name", "Enter the photographer's name, as shown on Unsplash.");
      if (!v.source_url) need("source_url", "Paste the photo's Unsplash page address.");
      if (!v.credit_url) need("credit_url", "Paste the photographer's Unsplash profile address.");
      check("source_url", https("Paste the address of the photo's page, starting https://unsplash.com/photos/.").regex(/^https:\/\/unsplash\.com\/photos\//, "Paste the address of the photo's page, starting https://unsplash.com/photos/."));
      check("credit_url", https("Paste the photographer's profile address, starting https://unsplash.com/@.").regex(/^https:\/\/unsplash\.com\/@/, "Paste the photographer's profile address, starting https://unsplash.com/@."));
    }
    if (v.source === "other") {
      if (!v.credit_name) need("credit_name", "Enter the credit the licence asks for, such as the photographer's name.");
      if (!v.licence) need("licence", "Enter the licence's name, such as CC BY 4.0.");
      if (!v.source_url) need("source_url", "Paste the address where the photo and its licence are shown.");
      check("source_url", https("Paste an address starting https://."));
      if (!v.commercial_use_confirmed) need("commercial_use_confirmed", "Confirm the licence allows commercial use, or choose a different photo.");
    }
    if (v.source === "own") check("credit_url", https("Paste an address starting https://."));
  });
export type GuidePhotoDetails = z.infer<typeof guidePhotoDetailsSchema>;

/** The columns to write for a photo's details (empty fields as null, unused ones cleared). */
export function guidePhotoColumns(v: GuidePhotoDetails) {
  const t = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    alt_text: v.alt_text.trim(),
    source: v.source,
    credit_name: t(v.credit_name),
    credit_url: v.source === "other" ? null : t(v.credit_url),
    source_url: v.source === "own" ? null : t(v.source_url),
    licence: v.source === "other" ? t(v.licence) : null,
    commercial_use_confirmed: v.source === "other" ? !!v.commercial_use_confirmed : false,
  };
}

/** A photo as the guide body renderer needs it (packages/ui GuideBody). */
export interface GuideBodyPhoto {
  url: string;
  width: number;
  height: number;
  alt: string;
  credit: CreditPart[] | null;
}

/** A credit line as pieces of text, some linked, exactly as the guide page shows it. Null when there's no credit. */
export type CreditPart = { text: string; href?: string };
export function photoCredit(p: Pick<GuidePhoto, "source" | "credit_name" | "credit_url" | "source_url" | "licence">): CreditPart[] | null {
  // Unsplash asks for these on links back to it.
  const ref = (url: string) => `${url}${url.includes("?") ? "&" : "?"}utm_source=lokl&utm_medium=referral`;
  if (p.source === "unsplash" && p.credit_name) {
    return [
      { text: "Photo by " },
      { text: p.credit_name, href: p.credit_url ? ref(p.credit_url) : undefined },
      { text: " on " },
      { text: "Unsplash", href: ref("https://unsplash.com/") },
    ];
  }
  if (p.source === "other" && p.credit_name) {
    return [
      { text: "Photo: " },
      { text: p.credit_name, href: p.source_url ?? undefined },
      ...(p.licence ? [{ text: ` (${p.licence})` }] : []),
    ];
  }
  if (p.source === "own" && p.credit_name) {
    return [{ text: "Photo: " }, { text: p.credit_name, href: p.credit_url ?? undefined }];
  }
  return null;
}
