import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListingKind, PublicListingCard } from "@repo/types";
import { browsePublicListings } from "./publicListings";

// A guide's listings block (docs/design/destination-guides.md): the live
// listings in its area and/or category, optionally of one kind. Uses the
// browse pages' own query with the signed-out client, so it shows exactly
// what a visitor would see (hidden categories and areas, suspended
// providers and unlisted listings are left out by the same rules).

export interface GuideListingsQuery {
  marketId: string;
  areaId?: string | null;
  categoryId?: string | null;
  kind?: ListingKind | null;
}

export interface GuideListingsResult {
  total: number;
  items: PublicListingCard[];
  /** Set when the chosen area or category is hidden from the site, so nothing can match. */
  hidden: "area" | "category" | null;
}

export async function guideListings(db: SupabaseClient, q: GuideListingsQuery, limit = 12): Promise<GuideListingsResult> {
  const none = (hidden: GuideListingsResult["hidden"] = null): GuideListingsResult => ({ total: 0, items: [], hidden });
  if (!q.areaId && !q.categoryId) return none();

  const { data: market, error } = await db.from("cities").select("slug").eq("id", q.marketId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!market) return none();

  let category: { slug: string; kind: ListingKind } | null = null;
  if (q.categoryId) {
    const { data, error: e } = await db.from("categories").select("slug, kind").eq("id", q.categoryId).maybeSingle();
    if (e) throw new Error(e.message);
    if (!data) return none("category");
    category = data as { slug: string; kind: ListingKind };
  }
  if (q.areaId) {
    const { data, error: e } = await db.from("service_areas").select("id").eq("id", q.areaId).maybeSingle();
    if (e) throw new Error(e.message);
    if (!data) return none("area");
  }

  // A category belongs to one kind; otherwise the chosen kind, or both.
  const kinds: ListingKind[] = category ? [category.kind] : q.kind ? [q.kind] : ["experience", "service"];
  const results = await Promise.all(
    kinds.map((kind) =>
      browsePublicListings(db, { market: market.slug, kind, category: category?.slug, area: q.areaId ?? undefined }),
    ),
  );
  const items = results.flatMap((r) => r?.items ?? []);
  return { total: results.reduce((n, r) => n + (r?.total ?? 0), 0), items: items.slice(0, limit), hidden: null };
}
