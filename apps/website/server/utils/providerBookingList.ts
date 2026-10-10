import type { SupabaseClient } from "@supabase/supabase-js";

// The provider's bookings list (GET /api/provider/bookings), in three tabs
// (docs/design/booking-and-checkout.md, Provider pages). Read through the
// provider's own client, so RLS applies: bookings on their listings, and the
// customer's email, phone and address only once accepted or confirmed (the
// rows are simply missing before). Checkouts never finished aren't shown:
// the provider never had them as a request or a booking.

const BOOKING_LIST_FIELDS =
  "id, kind, status, listing_id, starts_at, ends_at, preferred_times, party_size, total_cents, respond_by, " +
  "customer_name, customer_notes, customer_city, customer_postal_code, cancelled_by, created_at, " +
  "listing:listings(title, location_mode, duration_minutes, city:cities(name, timezone)), " +
  "contact:booking_contacts(email, phone), address:booking_addresses(line1, line2, city, state, postal_code, instructions), " +
  // Their share, from booking_finances (RLS: providers read their bookings' finances).
  "finances:booking_finances(provider_amount_cents)";

export const PROVIDER_BOOKING_TABS = ["requests", "upcoming", "past"] as const;
export type ProviderBookingTab = (typeof PROVIDER_BOOKING_TABS)[number];
export const PROVIDER_BOOKINGS_PAGE_SIZE = 20;

export interface ProviderBookingsPage {
  tab: ProviderBookingTab;
  items: any[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<ProviderBookingTab, number>;
}

/**
 * Which bookings each tab holds, as a database filter, so each tab is
 * counted, ordered and paged by the database: none can drop out because
 * others were made after it.
 * - Requests: waiting for the provider's answer.
 * - Upcoming: confirmed, not yet ended.
 * - Past: everything else that was ever a request or a booking. An expired
 *   or cancelled one with neither an answer-by time nor a confirmation was a
 *   checkout never paid (it ran out, or couldn't start), so it isn't.
 */
function inTab<Q extends { eq: any; gt: any; or: any }>(q: Q, tab: ProviderBookingTab, now: string): Q {
  if (tab === "requests") return q.eq("status", "requested");
  if (tab === "upcoming") return q.eq("status", "confirmed").gt("ends_at", now);
  return q.or(`status.in.(declined,completed,paid_out),and(status.in.(expired,cancelled),or(respond_by.not.is.null,confirmed_at.not.is.null)),and(status.eq.confirmed,ends_at.lte.${now})`);
}

/** One page of one tab of the provider's bookings, with every tab's count. */
export async function providerBookingsPage(db: SupabaseClient, providerId: string, tab: ProviderBookingTab, page: number, now = Date.now()): Promise<ProviderBookingsPage> {
  const at = new Date(now).toISOString();
  const p = Math.max(1, Math.floor(page) || 1);
  const size = PROVIDER_BOOKINGS_PAGE_SIZE;
  // bounded: paged below with .range()
  let list = inTab(db.from("bookings").select(BOOKING_LIST_FIELDS, { count: "exact" }).eq("provider_id", providerId), tab, at);
  list = tab === "requests" ? list.order("respond_by", { ascending: true })
    : tab === "upcoming" ? list.order("starts_at", { ascending: true })
    : list.order("starts_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  const count = (t: ProviderBookingTab) => inTab(db.from("bookings").select("id", { count: "exact", head: true }).eq("provider_id", providerId), t, at);
  const [rows, ...counts] = await Promise.all([
    list.order("id").range((p - 1) * size, p * size - 1),
    ...PROVIDER_BOOKING_TABS.map(count),
  ]);
  for (const r of [rows, ...counts]) if (r.error) throw new Error(r.error.message);
  return {
    tab, page: p, pageSize: size, total: rows.count ?? 0,
    items: ((rows.data ?? []) as any[]).map((b) => ({ ...b, provider_amount_cents: b.finances?.provider_amount_cents ?? 0, finances: undefined })),
    counts: Object.fromEntries(PROVIDER_BOOKING_TABS.map((t, i) => [t, counts[i]!.count ?? 0])) as Record<ProviderBookingTab, number>,
  };
}
