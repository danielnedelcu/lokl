import { serverSupabaseClient } from "#supabase/server";
import type { MySaved } from "@repo/types";

// GET /api/account/saved: the signed-in customer's Saved page
// (docs/design/favourites.md). my_saved() says what they saved and what's
// still available (as the customer, so only their own); the available items
// are then loaded as a signed-out visitor sees them, so nothing here is more
// than the public pages show. Something that became hidden in between is
// shown as no longer available, with the name my_saved() allowed.
interface SavedRows {
  listings: { listing_id: string; saved_at: string; available: boolean; title: string | null }[];
  providers: { provider_id: string; saved_at: string; available: boolean; name: string | null }[];
}

export default defineEventHandler(async (event): Promise<MySaved> => {
  await requireUser(event);
  const { data, error } = await (await serverSupabaseClient(event)).rpc("my_saved");
  if (error || !data) throw createError({ statusCode: 500, statusMessage: "Your saved items didn't load. Please try again." });
  const rows = data as unknown as SavedRows;
  let cards, providers;
  try {
    const db = usePublicDb(event);
    [cards, providers] = await Promise.all([
      loadSavedListingCards(db, rows.listings.filter((r) => r.available).map((r) => r.listing_id)),
      loadSavedProviders(db, rows.providers.filter((r) => r.available).map((r) => r.provider_id)),
    ]);
  } catch (e) {
    throw publicFailure(e);
  }
  return {
    listings: rows.listings.map((r) => ({ id: r.listing_id, savedAt: r.saved_at, card: cards.get(r.listing_id) ?? null, title: r.title })),
    providers: rows.providers.map((r) => ({ id: r.provider_id, savedAt: r.saved_at, provider: providers.get(r.provider_id) ?? null, name: r.name })),
  };
});
