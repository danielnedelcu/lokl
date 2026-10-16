import type { ListingKind } from "./listings";
import type { PublicBrowseResult, PublicListingCard, PublicMarket } from "./public";

// The search results address (docs/design/search.md):
// /<market>/search?area=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&kind=<kind>&category=<slug>&page=N
// Every part is optional. No kind is the All view: both kinds, a section
// each (2026-10-16). A category's slug is unique only within its kind,
// so `category` counts only with `kind`. Dates filter both kinds: an
// Experience with a session on one of the days, a Service with a free time
// (docs/design/service-availability.md, "Search"), at most 31 days.
// Malformed values (a hand-edited or old link) are dropped, never an error;
// a range longer than 31 days is kept, and the page says to shorten it.

export interface SearchFilters {
  area?: string;
  from?: string;
  to?: string;
  kind?: ListingKind;
  category?: string;
  page?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
const one = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);

/** The longest date range search takes, in days (both ends counted). */
export const MAX_SEARCH_DAYS = 31;
/** What the search says about a longer range. */
export const SEARCH_RANGE_TOO_LONG = `Choose up to ${MAX_SEARCH_DAYS} days.`;

/** How many days a range of calendar dates ("YYYY-MM-DD") covers, both ends counted. */
export function searchDays(from: string, to: string): number {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((day(to) - day(from)) / 86_400_000) + 1;
}

/** The filters in a results address's query, malformed values dropped. */
export function readSearch(query: Record<string, unknown>): SearchFilters {
  const out: SearchFilters = {};
  const area = one(query.area);
  if (area && ID.test(area)) out.area = area;
  let from = one(query.from);
  let to = one(query.to);
  if (from && !DATE.test(from)) from = undefined;
  if (to && !DATE.test(to)) to = undefined;
  // One date alone is that day; a range given backwards is put right.
  if (from && !to) to = from;
  if (to && !from) from = to;
  if (from && to && from > to) [from, to] = [to, from];
  if (from && to) Object.assign(out, { from, to });
  const kind = one(query.kind);
  if (kind === "experience" || kind === "service") out.kind = kind;
  const category = one(query.category);
  if (out.kind && category && SLUG.test(category)) out.category = category;
  // Pages are a single kind's; the All view has none.
  const page = Number(one(query.page));
  if (out.kind && Number.isInteger(page) && page > 1 && page <= 1000) out.page = page;
  return out;
}

/** A results address for `market` with these filters, in a fixed order. */
export function searchPath(market: string, f: SearchFilters): string {
  const q = new URLSearchParams();
  if (f.area) q.set("area", f.area);
  // One day alone (no second day chosen) is that day.
  if (f.from) {
    q.set("from", f.from);
    q.set("to", f.to ?? f.from);
  }
  if (f.kind) q.set("kind", f.kind);
  if (f.kind && f.category) q.set("category", f.category);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return `/${market}/search${s ? `?${s}` : ""}`;
}

/** How many of each kind the All view shows before "See all". */
export const SEARCH_SECTION_SIZE = 6;

/** One kind's first results in the All view, and how many there are. */
export interface SearchSection {
  items: PublicListingCard[];
  total: number;
}

/**
 * The results page's data, with both kinds' counts: the All view (no kind)
 * has each kind's first results; a kind's view has one page of it.
 */
export type PublicSearchResult =
  | ({ view: "all"; market: PublicMarket; sections: Record<ListingKind, SearchSection> } & { counts: Record<ListingKind, number> })
  | (PublicBrowseResult & { view: ListingKind; counts: Record<ListingKind, number> });
