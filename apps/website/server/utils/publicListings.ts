// Queries behind the public pages (docs/design/browse-and-listing-pages.md,
// Data and access). Every function takes a signed-out Supabase client
// (publicSupabase below), so RLS decides what exists: only visible listings
// (live, with an active provider, category and market), their photos, future
// scheduled sessions, active areas, and the provider's business name. The
// explicit status filters repeat what RLS already enforces, to keep the
// intent readable.
//
// Plain TypeScript with no Nuxt imports, so the leak check
// (supabase/tests/realtime/public-routes.leak.test.mts) runs this same code
// against the local stack.
//
// Browse filters, sorts, counts and pages in the database (public_browse,
// read with visitors' own rules), then loads only that page's cards.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { allRows, isTopRated, rpcJson } from "@repo/types";
import type {
  AreaKind,
  ListingKind,
  LocationMode,
  PublicArea,
  PublicBrowseResult,
  PublicListing,
  PublicListingCard,
  PublicMarket,
  PublicMarketInfo,
  PublicPhoto,
  PublicProvider,
  PublicProviderPage,
  PublicReview,
  PublicReviewPage,
  RatingSummary,
  StarCounts,
} from "@repo/types";
import { zonedToInstant } from "../../../../packages/ui/app/utils/zonedTime";

export const PAGE_SIZE = 24;
/** URLs one sitemap file may hold (the sitemap protocol). */
export const SITEMAP_MAX_URLS = 50_000;
/** The most rows the sitemap reads from one table before stopping with an error. */
const READ_MAX = 200_000;

/** A Supabase client that is always signed out: no cookies, no stored session. */
export function publicSupabase(url: string, publishableKey: string): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// A provider's public profile columns (the only ones visitors may read;
// column grants enforce it), with their market's name.
// Ratings (docs/design/reviews.md) are kept by the database on their own
// rows, readable as far as the listing or provider is.
const RATING_COLUMNS = "review_count, rating_average, stars_1, stars_2, stars_3, stars_4, stars_5";
const PROVIDER_PUBLIC = `id, slug, display_name, headline, bio, avatar_path, avatar_small_path, cover_path, cover_card_path, created_at, market:cities(name, slug, state, timezone), ratings:provider_ratings(${RATING_COLUMNS})`;
interface RatingRow {
  review_count: number;
  rating_average: number | string | null;
  stars_1: number; stars_2: number; stars_3: number; stars_4: number; stars_5: number;
}
const toRating = (r: RatingRow | null | undefined): RatingSummary =>
  ({ count: r?.review_count ?? 0, average: r?.rating_average == null ? null : Number(r.rating_average) });
const toStars = (r: RatingRow | null | undefined): StarCounts =>
  [r?.stars_1 ?? 0, r?.stars_2 ?? 0, r?.stars_3 ?? 0, r?.stars_4 ?? 0, r?.stars_5 ?? 0];
interface ProviderRow {
  id: string; slug: string; display_name: string; headline: string | null; bio: string | null;
  avatar_path: string | null; avatar_small_path: string | null; cover_path: string | null; cover_card_path: string | null;
  created_at: string; market: PublicMarket | null;
  ratings: RatingRow | null;
}
const toProvider = (p: ProviderRow): PublicProvider => ({
  id: p.id, slug: p.slug, name: p.display_name, headline: p.headline, bio: p.bio,
  avatarPath: p.avatar_path, avatarSmallPath: p.avatar_small_path, coverPath: p.cover_path, coverCardPath: p.cover_card_path,
  market: p.market?.name ?? null, since: p.created_at, rating: toRating(p.ratings),
});

// The two service_areas embeds name their relationship: the listing's own
// area (area_id) and its travel areas (through listing_service_areas).
const LISTING_SELECT = `
  id, kind, slug, title, description, price_cents, currency, duration_minutes, location_mode, booking_mode, created_at,
  category:categories!inner(name, slug),
  city:cities!inner(name, slug, state, timezone),
  area:service_areas!listings_area_id_fkey(id, name, kind),
  travel:listing_service_areas(area:service_areas!listing_service_areas_service_area_id_fkey(id, name, kind)),
  photos:listing_photos(storage_path, card_path, alt_text, position),
  hostedBy:providers(${PROVIDER_PUBLIC}),
  sessions:experience_sessions(id, starts_at),
  ratings:listing_ratings(${RATING_COLUMNS})
`;

interface Row {
  id: string;
  kind: ListingKind;
  slug: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  duration_minutes: number | null;
  location_mode: LocationMode | null;
  booking_mode: "instant" | "approve" | null;
  created_at: string;
  category: { name: string; slug: string };
  city: PublicMarket;
  area: { id: string; name: string; kind: AreaKind } | null;
  travel: { area: { id: string; name: string; kind: AreaKind } | null }[];
  photos: { storage_path: string; card_path: string | null; alt_text: string; position: number }[];
  hostedBy: ProviderRow | null;
  sessions: { id: string; starts_at: string }[];
  ratings: RatingRow | null;
}

const toArea = (a: { name: string; kind: AreaKind }): PublicArea => ({ name: a.name, kind: a.kind });
const toPhoto = (p: Row["photos"][number]): PublicPhoto => ({ path: p.storage_path, cardPath: p.card_path, alt: p.alt_text });

function toCard(r: Row): PublicListingCard & { areaIds: string[]; sessionTimes: number[]; createdAt: string } {
  const photos = [...r.photos].sort((a, b) => a.position - b.position);
  const sessionTimes = r.sessions.map((s) => Date.parse(s.starts_at)).filter((t) => t > Date.now()).sort((a, b) => a - b);
  const travel = r.travel.map((t) => t.area).filter((a): a is NonNullable<typeof a> => !!a);
  return {
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    priceCents: r.price_cents,
    currency: r.currency,
    durationMinutes: r.duration_minutes,
    category: r.category,
    area: r.area ? toArea(r.area) : null,
    travelAreas: travel.map(toArea),
    cover: photos[0] ? toPhoto(photos[0]) : null,
    nextSessionAt: sessionTimes[0] ? new Date(sessionTimes[0]).toISOString() : null,
    providerId: r.hostedBy?.id ?? "",
    rating: toRating(r.ratings),
    topRated: isTopRated(toStars(r.ratings)),
    // For filtering and sorting only; not sent to pages.
    areaIds: [r.area?.id, ...travel.map((a) => a.id)].filter((id): id is string => !!id),
    sessionTimes,
    createdAt: r.created_at,
  };
}

function stripInternal(c: ReturnType<typeof toCard>): PublicListingCard {
  const { areaIds: _a, sessionTimes: _s, createdAt: _c, ...card } = c;
  return card;
}

/** One visible listing, or null (anything not public reads as not found). */
export async function loadPublicListing(db: SupabaseClient, kind: ListingKind, slug: string): Promise<PublicListing | null> {
  const { data, error } = await db
    .from("listings")
    .select(LISTING_SELECT)
    .eq("kind", kind)
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as Row;
  const card = toCard(r);
  // Spots left per upcoming session (session_spots_left counts bookings and
  // unexpired reservations the visitor can't read).
  const upcoming = r.sessions.filter((s) => Date.parse(s.starts_at) > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const spots = await Promise.all(upcoming.map(async (s) => {
    const { data: left } = await db.rpc("session_spots_left", { p_session_id: s.id });
    return { id: s.id, startsAt: new Date(s.starts_at).toISOString(), spotsLeft: (left as number | null) ?? 0 };
  }));
  // A Service's first free time anywhere in its booking window, or none
  // ("Not taking bookings yet": no hours, or every time taken).
  let nextSlotAt: string | null = null;
  if (r.kind === "service") {
    const { data: next, error: nextError } = await db.rpc("service_next_slot", { p_listing_id: r.id });
    if (nextError) throw new Error(nextError.message);
    nextSlotAt = next ? new Date(next as string).toISOString() : null;
  }
  return {
    ...stripInternal(card),
    description: r.description,
    locationMode: r.location_mode,
    bookingMode: r.booking_mode,
    nextSlotAt,
    market: r.city,
    hostedBy: r.hostedBy?.display_name ?? "",
    providerId: r.hostedBy?.id ?? "",
    photos: [...r.photos].sort((a, b) => a.position - b.position).map(toPhoto),
    sessions: spots,
    provider: r.hostedBy ? toProvider(r.hostedBy) : null,
    moreFromProvider: r.hostedBy ? await moreFromProvider(db, r.hostedBy.id, r.id) : { items: [], total: 0 },
    stars: toStars(r.ratings),
  };
}

/** Up to three of the provider's other visible listings, newest first, and how many there are. */
async function moreFromProvider(db: SupabaseClient, providerId: string, exceptId: string) {
  const { data, error, count } = await db
    .from("listings")
    .select(LISTING_SELECT, { count: "exact" })
    .eq("provider_id", providerId)
    .eq("status", "live")
    .neq("id", exceptId)
    .order("published_at", { ascending: false })
    .limit(3);
  if (error) throw new Error(error.message);
  return { items: ((data ?? []) as unknown as Row[]).map((r) => stripInternal(toCard(r))), total: count ?? 0 };
}

/**
 * A provider's public profile page, or null when it isn't public (the
 * provider is suspended, or has no visible listing: the public read rule
 * returns nothing then).
 */
export async function loadPublicProvider(db: SupabaseClient, slug: string): Promise<PublicProviderPage | null> {
  const { data, error } = await db.from("providers").select(PROVIDER_PUBLIC).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as ProviderRow;
  const provider = toProvider(row);
  const { data: rows, error: lErr } = await db
    .from("listings")
    .select(LISTING_SELECT)
    .eq("provider_id", provider.id)
    .eq("status", "live")
    .order("published_at", { ascending: false })
    .limit(100);
  if (lErr) throw new Error(lErr.message);
  const cards = ((rows ?? []) as unknown as Row[]).map((r) => stripInternal(toCard(r)));
  return { provider, stars: toStars(row.ratings), market: row.market, experiences: cards.filter((c) => c.kind === "experience"), services: cards.filter((c) => c.kind === "service") };
}

// Ids go in the request's address, so they're asked for 100 at a time: 500
// (the most one person can save) made an address of about 19 KB, which the
// API refuses as too long (found 2026-10-10).
const IDS_PER_REQUEST = 100;
async function byIds<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const chunks = Array.from({ length: Math.ceil(ids.length / IDS_PER_REQUEST) }, (_, i) => ids.slice(i * IDS_PER_REQUEST, (i + 1) * IDS_PER_REQUEST));
  const results = await Promise.all(chunks.map(read));
  for (const r of results) if (r.error) throw new Error(r.error.message);
  return results.flatMap((r) => (r.data ?? []) as T[]);
}

/** Saved listings that are visible now, as visitors see them (the Saved page). */
export async function loadSavedListingCards(db: SupabaseClient, ids: string[]) {
  const found = new Map<string, PublicListingCard & { market: PublicMarket }>();
  // bounded: at most IDS_PER_REQUEST ids
  const rows = await byIds<Row>(ids, (chunk) => db.from("listings").select(LISTING_SELECT).in("id", chunk).eq("status", "live"));
  for (const r of rows) found.set(r.id, { ...stripInternal(toCard(r)), market: r.city });
  return found;
}

/** Saved providers whose profiles are public now (the Saved page). */
export async function loadSavedProviders(db: SupabaseClient, ids: string[]) {
  const found = new Map<string, PublicProvider>();
  // bounded: at most IDS_PER_REQUEST ids
  const rows = await byIds<ProviderRow>(ids, (chunk) => db.from("providers").select(PROVIDER_PUBLIC).in("id", chunk));
  for (const r of rows) found.set(r.id, toProvider(r));
  return found;
}

export const REVIEWS_PAGE_SIZE = 10;

/**
 * A listing's or provider's published reviews, newest first, 10 a page,
 * read as a visitor (docs/design/reviews.md). On a provider's, each names
 * its listing while that listing is live (null otherwise: the read rules
 * hide it). The reply comes with it.
 */
export async function loadPublicReviews(db: SupabaseClient, by: { listingId: string } | { providerId: string }, page: number): Promise<PublicReviewPage> {
  const p = Math.max(1, Math.floor(page) || 1);
  // bounded: paged below with .range()
  let q = db
    .from("reviews")
    .select("id, rating, body, reviewer_name, booking_month, created_at, edited_at, listing:listings(title, slug, kind), reply:review_replies(body, created_at, edited_at)", { count: "exact" });
  q = "listingId" in by ? q.eq("listing_id", by.listingId) : q.eq("provider_id", by.providerId);
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((p - 1) * REVIEWS_PAGE_SIZE, p * REVIEWS_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  type R = {
    id: string; rating: number; body: string; reviewer_name: string; booking_month: string; created_at: string; edited_at: string | null;
    listing: { title: string; slug: string; kind: ListingKind } | null;
    reply: { body: string; created_at: string; edited_at: string | null } | { body: string; created_at: string; edited_at: string | null }[] | null;
  };
  const items: PublicReview[] = ((data ?? []) as unknown as R[]).map((r) => {
    const reply = Array.isArray(r.reply) ? r.reply[0] ?? null : r.reply;
    return {
      id: r.id, rating: r.rating, body: r.body, reviewerName: r.reviewer_name, bookingMonth: r.booking_month,
      createdAt: r.created_at, editedAt: r.edited_at, listing: r.listing,
      reply: reply ? { body: reply.body, createdAt: reply.created_at, editedAt: reply.edited_at } : null,
    };
  });
  return { items, total: count ?? 0, page: p, pageSize: REVIEWS_PAGE_SIZE };
}

export interface BrowseQuery {
  market: string;
  kind: ListingKind;
  category?: string;
  /** A service area id in the market. */
  area?: string;
  /** Local dates (YYYY-MM-DD) in the market's time zone, inclusive: Experiences with a session, Services with a free time. */
  from?: string;
  to?: string;
  page?: number;
  /** Cards per page (default PAGE_SIZE); guides show fewer. */
  pageSize?: number;
}

/**
 * One visible listing of a kind, chosen at random (the homepage's "On lokl
 * now", 2026-10-12): the browse order's count, then the listing at a random
 * position, so it follows exactly the rules browse does. Null if there's none.
 * `random` is for tests.
 */
export async function pickPublicListing(db: SupabaseClient, market: string, kind: ListingKind, random = Math.random) {
  const first = await browsePublicListings(db, { market, kind, pageSize: 1 });
  if (!first) return { market: null, card: null };
  if (!first.total) return { market: first.market, card: null };
  const position = Math.min(first.total, Math.floor(random() * first.total) + 1);
  if (position === 1) return { market: first.market, card: first.items[0] ?? null };
  const picked = await browsePublicListings(db, { market, kind, page: position, pageSize: 1 });
  return { market: first.market, card: picked?.items[0] ?? first.items[0] ?? null };
}

/** A market's visible listings of one kind, filtered and paged; null if the market or category isn't public. */
export async function browsePublicListings(db: SupabaseClient, q: BrowseQuery): Promise<PublicBrowseResult | null> {
  const { data: market, error: marketError } = await db
    .from("cities")
    .select("name, slug, state, timezone")
    .eq("slug", q.market)
    .maybeSingle();
  if (marketError) throw new Error(marketError.message);
  if (!market) return null;

  if (q.category) {
    const { data: category } = await db.from("categories").select("id").eq("kind", q.kind).eq("slug", q.category).maybeSingle();
    if (!category) return null;
  }

  // The database picks the page, in browse order, with the total
  // (public_browse, read with visitors' own rules), so nothing is cut off at
  // the API's 1,000 rows; then only that page's cards are loaded.
  const tz = (market as PublicMarket).timezone;
  const page = Math.max(1, Math.floor(q.page ?? 1) || 1);
  const pageSize = q.pageSize ?? PAGE_SIZE;
  const { data: picked, error: pickError } = await db.rpc("public_browse", {
    p_market: q.market,
    p_kind: q.kind,
    p_category: q.category,
    p_area: q.area,
    p_from: q.from ? zonedToInstant({ date: q.from, time: "00:00" }, tz) : undefined,
    // Inclusive of the whole last day: up to midnight at the start of the next.
    p_to: q.to ? new Date(Date.parse(zonedToInstant({ date: q.to, time: "23:59" }, tz)) + 60_000).toISOString() : undefined,
    p_page: page,
    p_page_size: pageSize,
  });
  if (pickError) throw new Error(pickError.message);
  // Services: those on the page with no free time in their window
  // (undated), and each one's first free day in the searched dates.
  const { ids, total, closed, firstDays } = rpcJson("public_browse", picked);
  const closedIds = new Set(closed ?? []);

  let cards: ReturnType<typeof toCard>[] = [];
  if (ids.length) {
    // bounded: one browse page's ids (public_browse caps a page at 100)
    const { data, error } = await db.from("listings").select(LISTING_SELECT).in("id", ids).eq("status", "live");
    if (error) throw new Error(error.message);
    const byId = new Map((data as unknown as Row[]).map((r) => [r.id, toCard(r)]));
    cards = ids.map((id) => byId.get(id)).filter((c): c is ReturnType<typeof toCard> => !!c);
  }

  return {
    market: market as PublicMarket,
    kind: q.kind,
    items: cards.map(stripInternal).map((c) => (c.kind === "service"
      ? { ...c, notTakingBookings: closedIds.has(c.id), openOn: firstDays?.[c.id] ?? null }
      : c)),
    page,
    pageSize,
    total,
  };
}

/** A public market with its categories (and visible-listing counts) and areas; null if not public. */
export async function loadPublicMarket(db: SupabaseClient, slug: string): Promise<PublicMarketInfo | null> {
  const { data: market, error } = await db.from("cities").select("id, name, slug, state, timezone").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!market) return null;

  // Visible listings per category, counted by the database
  // (public_category_counts, visitors' own rules).
  const [categories, areas, counted] = await Promise.all([
    db.from("categories").select("id, kind, name, slug, description").order("sort_order").order("name"),
    db.from("service_areas").select("id, name, kind").eq("city_id", market.id).order("sort_order").order("name"),
    db.rpc("public_category_counts", { p_market_id: market.id }),
  ]);
  for (const r of [categories, areas, counted]) if (r.error) throw new Error(r.error.message);
  const counts = new Map(Object.entries(rpcJson("public_category_counts", counted.data)));

  const { id: _id, ...publicMarket } = market;
  return {
    market: publicMarket as PublicMarket,
    categories: (categories.data as { id: string; kind: ListingKind; name: string; slug: string; description: string | null }[]).map(
      ({ id, ...c }) => ({ ...c, count: counts.get(id) ?? 0 }),
    ),
    areas: areas.data as (PublicArea & { id: string })[],
  };
}

interface SitemapListing { kind: ListingKind; slug: string; updated_at: string; city: { slug: string }; category: { slug: string } }

/** Every public URL, for the sitemap: markets, their browse and category pages with listings, and each visible listing. */
export async function publicSitemapEntries(db: SupabaseClient): Promise<{ loc: string; lastmod?: string }[]> {
  // Every visible listing and provider, a page of 1,000 at a time
  // (allRows): one read stopped at the API's 1,000 rows (found 2026-10-10).
  const [markets, rows] = await Promise.all([
    db.from("cities").select("slug").order("sort_order"),
    allRows((from, to) => db.from("listings")
      .select("id, kind, slug, updated_at, city:cities!inner(slug), category:categories!inner(slug)")
      .eq("status", "live")
      .order("id")
      .range(from, to), READ_MAX).then((r) => r as unknown as SitemapListing[]),
  ]);
  if (markets.error) throw new Error(markets.error.message);
  const plural = (k: ListingKind) => (k === "experience" ? "experiences" : "services");

  const entries = new Map<string, string | undefined>();
  for (const m of markets.data as { slug: string }[]) {
    entries.set(`/${m.slug}`, undefined);
    entries.set(`/${m.slug}/experiences`, undefined);
    entries.set(`/${m.slug}/services`, undefined);
  }
  for (const r of rows) {
    entries.set(`/${r.city.slug}/${plural(r.kind)}/${r.category.slug}`, undefined);
    entries.set(`/${plural(r.kind)}/${r.slug}`, r.updated_at);
  }
  // Destination guides: each market's index (once it has a guide) and every
  // published guide, dated by when its content last changed.
  for (const m of markets.data as { slug: string }[]) {
    const { data, error } = await db.rpc("public_guides", { p_market: m.slug });
    if (error) throw new Error(error.message);
    // A market that isn't public has none.
    const guides = rpcJson("public_guides", data)?.guides ?? [];
    if (!guides.length) continue;
    entries.set(`/${m.slug}/guides`, guides[0]!.content_updated_at);
    for (const g of guides) entries.set(`/${m.slug}/guides/${g.slug}`, g.content_updated_at);
  }
  // Provider profiles: only the public ones (the visitors' read rule: active,
  // with a visible listing).
  const providers = await allRows((from, to) => db.from("providers").select("id, slug").order("id").range(from, to), READ_MAX);
  for (const pr of providers) entries.set(`/providers/${pr.slug}`, undefined);
  const all = [...entries].map(([loc, lastmod]) => (lastmod ? { loc, lastmod } : { loc }));
  // One sitemap file holds at most 50,000 URLs; split it before then
  // (docs/TODO.md). Until it's split, the first 50,000 are listed and the
  // overflow is logged.
  if (all.length > SITEMAP_MAX_URLS) {
    console.error(`[sitemap] ${all.length} URLs, over the ${SITEMAP_MAX_URLS} one sitemap may hold: split the sitemap.`);
    return all.slice(0, SITEMAP_MAX_URLS);
  }
  return all;
}
