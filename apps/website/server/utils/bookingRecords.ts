// The server's view of a booking: private.booking_records, the booking with
// its finances (booking_finances) and no-show note (booking_reports), in a
// schema only the service role may use (migration booking_finances). One
// update through it writes all three, finances first, so the booking's
// rules see the money. Plain TypeScript: jobs, routes and tests share it.
//
// Reads that join other tables (a booking's listing, provider or session)
// can't go through it (the API doesn't join from a private view to public
// tables): those read `bookings` with FINANCES embedded, then withFinances().

import type { SupabaseClient } from "@supabase/supabase-js";

/** private.booking_records, for reads and writes with the server key. */
export const bookingRecords = (db: SupabaseClient) => db.schema("private").from("booking_records");

/** Embed a booking's finances in a `bookings` read: `select(\`id, ..., ${FINANCES}\`)`. */
export const FINANCES = "finances:booking_finances!inner(*)";

/** Flattens an embedded `finances` object into its booking row. */
export function withFinances<T extends Record<string, any>>(row: T): T {
  const { finances, ...rest } = row as any;
  return { ...rest, ...(finances ?? {}) } as T;
}
