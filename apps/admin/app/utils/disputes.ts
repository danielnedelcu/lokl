import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows, type Database } from "@repo/types";

// Disputes & refunds for the admin (docs/design/booking-and-checkout.md,
// Admin): disputes (chargebacks) from Stripe's webhooks, read from
// booking_finances where they're recorded; refunds from bookings. Admins
// read both. Open disputes are all listed (each has an evidence deadline);
// closed disputes and refunds are counted and paged by the database. Plain
// TypeScript, so supabase/tests/app/admin-disputes.test.mts
// runs this same code.

const BOOKING = "id, status, starts_at, total_cents, refunded_cents, refunded_at, cancelled_by, cancel_reason, problem_resolution, " +
  "listing:listings(title, city:cities(timezone)), provider:providers(display_name)";
const DISPUTE = "stripe_dispute_id, disputed_at, dispute_closed_at, dispute_outcome, dispute_reason, dispute_amount_cents, dispute_evidence_due_by";

export const DISPUTES_PAGE_SIZE = 25;

export interface DisputesPage {
  /** Every open dispute: each has an evidence deadline. */
  open: any[];
  closed: { items: any[]; total: number };
  refunds: { items: any[]; total: number };
}

/** Open disputes are few and each has a deadline, so all are read; this many means something is wrong. */
const OPEN_MAX = 5000;

export async function loadDisputes(supabase: SupabaseClient<Database>, pages: { closed?: number; refunds?: number } = {}): Promise<DisputesPage> {
  const range = (page = 1) => [(Math.max(1, page) - 1) * DISPUTES_PAGE_SIZE, Math.max(1, page) * DISPUTES_PAGE_SIZE - 1] as const;
  const disputes = () => supabase.from("booking_finances").select(`${DISPUTE}, booking:bookings(${BOOKING})`, { count: "exact" }).not("disputed_at", "is", null);
  // Ordered by a unique key last, so pages never repeat or skip a row.
  const [open, closed, refunds] = await Promise.all([
    allRows((from, to) => disputes().is("dispute_closed_at", null).order("disputed_at", { ascending: false }).order("booking_id").range(from, to), OPEN_MAX),
    disputes().not("dispute_closed_at", "is", null).order("disputed_at", { ascending: false }).order("booking_id").range(...range(pages.closed)),
    supabase.from("bookings").select(BOOKING, { count: "exact" }).gt("refunded_cents", 0)
      .order("refunded_at", { ascending: false }).order("id").range(...range(pages.refunds)),
  ]);
  if (closed.error) throw closed.error;
  if (refunds.error) throw refunds.error;
  const flat = (rows: any[]) => rows.map(({ booking, ...f }) => ({ ...booking, ...f }));
  return {
    open: flat(open as any[]),
    closed: { items: flat(closed.data ?? []), total: closed.count ?? 0 },
    refunds: { items: refunds.data ?? [], total: refunds.count ?? 0 },
  };
}
