import type { ListingKind } from "./listings";
import type { PublicBrowseResult } from "./public";

// The search results address (docs/design/search.md):
// /<market>/search?area=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&kind=<kind>&category=<slug>&page=N
// Every part is optional. A category's slug is unique only within its kind,
// so `category` counts only with `kind`. Dates are for Experiences only:
// they stay in the address with Services shown, but don't filter them.
// Malformed values (a hand-edited or old link) are dropped, never an error.

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
  const page = Number(one(query.page));
  if (Number.isInteger(page) && page > 1 && page <= 1000) out.page = page;
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

/** The results page's data: one page of the shown kind, and both kinds' counts. */
export interface PublicSearchResult extends PublicBrowseResult {
  counts: Record<ListingKind, number>;
  /** True when dates were given but the shown kind is Services, which they don't filter. */
  datesIgnored: boolean;
}
