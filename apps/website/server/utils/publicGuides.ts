import type { SupabaseClient } from "@supabase/supabase-js";
import type { HomepageGuide, PublicGuide, PublicGuidesIndex } from "@repo/types";
import { guideListings, type GuideListingsResult } from "./guideListings";

// Destination guides as visitors see them (docs/design/destination-guides.md,
// Public pages and SEO). The database functions return only the live copy of
// published guides in public markets; these call them with the signed-out
// client, like the rest of the public pages.

/** A market's published guides, or null if the market isn't public. */
export async function loadPublicGuides(db: SupabaseClient, market: string): Promise<PublicGuidesIndex | null> {
  const { data, error } = await db.rpc("public_guides", { p_market: market });
  if (error) throw new Error(error.message);
  return (data as PublicGuidesIndex | null) ?? null;
}

/** One published guide with its listings block (up to six live listings), or null. */
export async function loadPublicGuide(
  db: SupabaseClient,
  market: string,
  slug: string,
): Promise<{ guide: PublicGuide; listings: GuideListingsResult } | null> {
  const { data, error } = await db.rpc("public_guide", { p_market: market, p_slug: slug });
  if (error) throw new Error(error.message);
  const guide = (data as PublicGuide | null) ?? null;
  if (!guide) return null;
  const { data: city, error: cityError } = await db.from("cities").select("id").eq("slug", market).maybeSingle();
  if (cityError) throw new Error(cityError.message);
  const listings = city
    ? await guideListings(db, {
        marketId: city.id,
        areaId: guide.listings.area?.id ?? null,
        categoryId: guide.listings.category?.id ?? null,
        kind: guide.listings.kind,
      }, 6)
    : { total: 0, items: [], hidden: null };
  return { guide, listings };
}

/** The homepage's featured guides, in order (the first is the hero). */
export async function loadHomepageGuides(db: SupabaseClient): Promise<HomepageGuide[]> {
  const { data, error } = await db.rpc("public_homepage_guides");
  if (error) throw new Error(error.message);
  return (data as HomepageGuide[] | null) ?? [];
}
