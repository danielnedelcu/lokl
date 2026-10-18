// What lokl sends to Google Analytics (decided 2026-10-17; docs/decisions.md):
// measurement only, and nothing personal. Every event is built here, by a
// pure function that returns only its allowed keys: fixed words, public ids,
// slugs, counts, dates and prices. Never a name, an email, a phone number, a
// booking id or anything someone typed. Page addresses are cleaned to the
// path and a short list of search settings, and pages with someone's own
// details (account, dashboard, sign-in) are never measured.
//
// The website sends these through useAnalytics(), which also decides
// whether analytics may run at all (an id set, production, the site's own
// address, no Global Privacy Control). Tested in
// packages/ui/tests/analytics.test.mts and e2e journey 35.

export type AnalyticsEventName = "page_view" | "search" | "view_item" | "begin_checkout" | "purchase" | "booking_requested";
export type AnalyticsParams = Record<string, string | number | AnalyticsItem[]>;
export interface AnalyticsItem {
  item_id: string;
  item_category: "experience" | "service";
  item_category2: string;
}
export interface AnalyticsEvent {
  name: AnalyticsEventName;
  params: AnalyticsParams;
}

/** Paths never measured: someone's own details, or a sign-in code in the address. */
const NOT_MEASURED = [/^\/login(\/|$)/, /^\/confirm(\/|$)/, /^\/account(\/|$)/, /^\/dashboard(\/|$)/];
/** The only query settings a measured address keeps, by page. */
const KEPT_QUERY: { path: RegExp; keys: string[] }[] = [
  { path: /^\/[a-z0-9-]+\/search$/, keys: ["area", "from", "to", "kind", "category", "page"] },
  { path: /^\/(experiences|services)\/[a-z0-9-]+$/, keys: ["date"] },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A slug has at least one letter: a phone number written with dashes
// (404-555-0182) would otherwise pass for one.
const SLUG = /^(?=[a-z0-9-]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["experience", "service"] as const;

const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
const slug = (v: unknown) => (typeof v === "string" && v.length <= 80 && SLUG.test(v) ? v : null);
const kind = (v: unknown) => (KINDS.includes(v as (typeof KINDS)[number]) ? (v as (typeof KINDS)[number]) : null);
const money = (cents: unknown) => (typeof cents === "number" && Number.isFinite(cents) && cents >= 0 ? Math.round(cents) / 100 : 0);
const count = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);

/** Whether a path may be measured at all. */
export function analyticsMeasures(path: string): boolean {
  return !NOT_MEASURED.some((p) => p.test(path));
}

/**
 * The page's address as sent: the site's origin, the path, and only the
 * allowed search settings, each checked for its shape. Null for a page
 * that isn't measured.
 */
export function analyticsPageLocation(origin: string, path: string, query: Record<string, unknown>): string | null {
  const clean = path.replace(/\/+$/, "") || "/";
  if (!analyticsMeasures(clean) || !SLUG.test(clean.split("/").filter(Boolean).join("-") || "home")) return null;
  const keys = KEPT_QUERY.find((k) => k.path.test(clean))?.keys ?? [];
  const kept = new URLSearchParams();
  for (const key of keys) {
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") continue;
    const ok = key === "area" ? id(value) : key === "from" || key === "to" || key === "date" ? (DAY.test(value) ? value : null)
      : key === "kind" ? kind(value) : key === "category" ? slug(value) : key === "page" ? (/^\d{1,4}$/.test(value) ? value : null) : null;
    if (ok) kept.set(key, ok);
  }
  const q = kept.toString();
  return `${origin.replace(/\/$/, "")}${clean}${q ? `?${q}` : ""}`;
}

/** A page view of a measured page, with its cleaned address and the page's own title. */
export function pageViewEvent(location: string, title: string): AnalyticsEvent {
  return { name: "page_view", params: { page_location: location, page_title: title.slice(0, 100) } };
}

/** Search results shown: the filters as settings, and how many came back. */
export function searchEvent(s: { market: string; kind?: string | null; category?: string | null; area?: string | null; from?: string | null; to?: string | null; results: number }): AnalyticsEvent {
  const from = s.from && DAY.test(s.from) ? s.from : null;
  const to = s.to && DAY.test(s.to) ? s.to : from;
  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 : null;
  return {
    name: "search",
    params: {
      market: slug(s.market) ?? "other",
      kind: kind(s.kind) ?? "all",
      category: slug(s.category) ?? "any",
      area: id(s.area) ?? "any",
      date_range_days: days && days > 0 && days <= 31 ? days : "any",
      results: count(s.results, 10_000),
    },
  };
}

function item(l: { listingId: string; kind: string; category: string }): AnalyticsItem[] {
  const listing = id(l.listingId);
  const k = kind(l.kind);
  return listing && k ? [{ item_id: listing, item_category: k, item_category2: slug(l.category) ?? "other" }] : [];
}

/** A listing page opened: the listing's public id, its kind and category, and its listed price. */
export function viewItemEvent(l: { listingId: string; kind: string; category: string; market: string; priceCents: number }): AnalyticsEvent {
  return { name: "view_item", params: { items: item(l), market: slug(l.market) ?? "other", value: money(l.priceCents), currency: "USD" } };
}

type BookingMode = "experience" | "instant" | "approve";
const mode = (v: unknown): BookingMode => (v === "instant" || v === "approve" ? v : "experience");

/** Book or Request pressed, before Stripe: the listing, how it's booked, how many people, the total. */
export function beginCheckoutEvent(b: { listingId: string; kind: string; category: string; bookingMode?: string | null; partySize?: number | null; totalCents: number }): AnalyticsEvent {
  const params: AnalyticsParams = { items: item(b), booking_mode: mode(b.bookingMode), value: money(b.totalCents), currency: "USD" };
  if (kind(b.kind) === "experience") params.party_size = Math.max(1, count(b.partySize ?? 1, 10));
  return { name: "begin_checkout", params };
}

/**
 * Back from Stripe: "purchase" when the booking is confirmed (an Experience
 * or an Instant Service), "booking_requested" when an Approve request was
 * sent with the card held. No booking id: Google would get an id lokl can
 * tie to a person. The address is a neutral one, not the account page's.
 */
export function bookingDoneEvent(origin: string, b: { listingId: string; kind: string; category: string; bookingMode?: string | null; totalCents: number; status: "confirmed" | "requested" }): AnalyticsEvent {
  return {
    name: b.status === "confirmed" ? "purchase" : "booking_requested",
    params: {
      items: item(b),
      booking_mode: mode(b.bookingMode),
      value: money(b.totalCents),
      currency: "USD",
      page_location: `${origin.replace(/\/$/, "")}/booking-complete`,
      page_title: "Booking complete",
    },
  };
}
