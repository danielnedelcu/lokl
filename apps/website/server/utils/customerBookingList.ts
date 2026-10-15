import type { SupabaseClient } from "@supabase/supabase-js";

// The signed-in customer's own bookings (GET /api/account/bookings), read
// through their own client (RLS: bookings_read_customer), newest first, in
// two groups: Upcoming and Past. "latest" is the one most recent booking
// (the checkout form reuses its name). Checkouts never paid aren't shown. Plain TypeScript, so supabase/tests/app/customer-bookings-list.test.mts
// runs this same code.

export const CUSTOMER_BOOKING_GROUPS = ["upcoming", "past", "latest"] as const;
export type CustomerBookingGroup = (typeof CUSTOMER_BOOKING_GROUPS)[number];
export const CUSTOMER_BOOKINGS_PAGE_SIZE = 20;
const FIELDS = "id, kind, status, listing_id, service_mode, starts_at, ends_at, party_size, total_cents, respond_by, customer_name, created_at";

/**
 * Each group as a database filter, so it's counted, ordered and paged by
 * the database (reading every booking stopped at the API's 1,000 rows).
 * Past: declined, expired, cancelled, completed or paid out, or ended.
 * Upcoming: requested or confirmed, and not yet ended.
 */
export async function customerBookingsPage(db: SupabaseClient, customerId: string, group: CustomerBookingGroup, page = 1, now = Date.now()) {
  const at = new Date(now).toISOString();
  const p = Math.max(1, Math.floor(page) || 1);
  const size = group === "latest" ? 1 : CUSTOMER_BOOKINGS_PAGE_SIZE;
  // bounded: paged below with .range()
  let q = db.from("bookings").select(FIELDS, { count: "exact" }).eq("customer_id", customerId).neq("status", "pending_payment")
    // A checkout never paid (ran out, or couldn't start) was never a
    // booking: not listed, as on the provider's list.
    .or("status.not.in.(expired,cancelled),respond_by.not.is.null,confirmed_at.not.is.null");
  if (group === "past") q = q.or(`status.in.(declined,expired,cancelled,completed,paid_out),ends_at.lt.${at}`);
  if (group === "upcoming") q = q.in("status", ["requested", "confirmed"]).or(`ends_at.is.null,ends_at.gte.${at}`);
  const { data, error, count } = await q.order("created_at", { ascending: false }).order("id").range((p - 1) * size, p * size - 1);
  if (error) throw new Error(error.message);
  return { items: (data ?? []) as any[], total: group === "latest" ? Math.min(count ?? 0, 1) : count ?? 0, page: p, pageSize: size };
}
