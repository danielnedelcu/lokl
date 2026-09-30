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
// Browse filtering and sorting happen here, over at most BROWSE_LIMIT
// visible listings per market and kind. That's ample for launch; move it to
// a database function when a market outgrows it (docs/TODO.md).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
} from "@repo/types";
import { zonedToInstant } from "../../../../packages/ui/app/utils/zonedTime";

export const PAGE_SIZE = 24;
export const BROWSE_LIMIT = 1000;

/** A Supabase client that is always signed out: no cookies, no stored session. */
export function publicSupabase(url: string, publishableKey: string): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// The two service_areas embeds name their relationship: the listing's own
// area (area_id) and its travel areas (through listing_service_areas).
const LISTING_SELECT = `
  id, kind, slug, title, description, price_cents, currency, duration_minutes, location_mode, created_at,
  category:categories!inner(name, slug),
  city:cities!inner(name, slug, state, timezone),
  area:service_areas!listings_area_id_fkey(id, name, kind),
  travel:listing_service_areas(area:service_areas!listing_service_areas_service_area_id_fkey(id, name, kind)),
  photos:listing_photos(storage_path, card_path, alt_text, position),
  hostedBy:providers(display_name),
  sessions:experience_sessions(starts_at)
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
  created_at: string;
  category: { name: string; slug: string };
  city: PublicMarket;
  area: { id: string; name: string; kind: AreaKind } | null;
  travel: { area: { id: string; name: string; kind: AreaKind } | null }[];
  photos: { storage_path: string; card_path: string | null; alt_text: string; position: number }[];
  hostedBy: { display_name: string } | null;
  sessions: { starts_at: string }[];
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
  return {
    ...stripInternal(card),
    description: r.description,
    locationMode: r.location_mode,
    market: r.city,
    hostedBy: r.hostedBy?.display_name ?? "",
    photos: [...r.photos].sort((a, b) => a.position - b.position).map(toPhoto),
    sessions: card.sessionTimes.map((t) => ({ startsAt: new Date(t).toISOString() })),
  };
}

export interface BrowseQuery {
  market: string;
  kind: ListingKind;
  category?: string;
  /** A service area id in the market. */
  area?: string;
  /** Experiences: local dates (YYYY-MM-DD) in the market's time zone, inclusive. */
  from?: string;
  to?: string;
  page?: number;
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

  let query = db
    .from("listings")
    .select(LISTING_SELECT)
    .eq("kind", q.kind)
    .eq("status", "live")
    .eq("city.slug", q.market)
    .limit(BROWSE_LIMIT);
  if (q.category) query = query.eq("category.slug", q.category);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let cards = (data as unknown as Row[]).map(toCard);
  if (q.area) cards = cards.filter((c) => c.areaIds.includes(q.area!));
  if (q.kind === "experience" && (q.from || q.to)) {
    const tz = (market as PublicMarket).timezone;
    const start = q.from ? Date.parse(zonedToInstant({ date: q.from, time: "00:00" }, tz)) : -Infinity;
    // Inclusive of the whole last day: up to midnight at the start of the next.
    const end = q.to ? Date.parse(zonedToInstant({ date: q.to, time: "23:59" }, tz)) + 60_000 : Infinity;
    cards = cards.filter((c) => c.sessionTimes.some((t) => t >= start && t < end));
  }

  // Experiences: soonest next session first, those with none last.
  // Services: newest first.
  cards.sort((a, b) =>
    q.kind === "experience"
      ? (a.sessionTimes[0] ?? Infinity) - (b.sessionTimes[0] ?? Infinity) || a.title.localeCompare(b.title)
      : b.createdAt.localeCompare(a.createdAt),
  );

  const page = Math.max(1, q.page ?? 1);
  return {
    market: market as PublicMarket,
    kind: q.kind,
    items: cards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(stripInternal),
    page,
    pageSize: PAGE_SIZE,
    total: cards.length,
  };
}

/** A public market with its categories (and visible-listing counts) and areas; null if not public. */
export async function loadPublicMarket(db: SupabaseClient, slug: string): Promise<PublicMarketInfo | null> {
  const { data: market, error } = await db.from("cities").select("id, name, slug, state, timezone").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!market) return null;

  const [categories, areas, listings] = await Promise.all([
    db.from("categories").select("id, kind, name, slug, description").order("sort_order").order("name"),
    db.from("service_areas").select("id, name, kind").eq("city_id", market.id).order("sort_order").order("name"),
    db.from("listings").select("category_id").eq("city_id", market.id).eq("status", "live").limit(BROWSE_LIMIT * 2),
  ]);
  for (const r of [categories, areas, listings]) if (r.error) throw new Error(r.error.message);

  const counts = new Map<string, number>();
  for (const l of listings.data as { category_id: string }[]) counts.set(l.category_id, (counts.get(l.category_id) ?? 0) + 1);

  const { id: _id, ...publicMarket } = market;
  return {
    market: publicMarket as PublicMarket,
    categories: (categories.data as { id: string; kind: ListingKind; name: string; slug: string; description: string | null }[]).map(
      ({ id, ...c }) => ({ ...c, count: counts.get(id) ?? 0 }),
    ),
    areas: areas.data as (PublicArea & { id: string })[],
  };
}
