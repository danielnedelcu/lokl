// Shared by the admin's booking pages: what to read, and how a booking's
// payout reads in words. Admins read every booking through RLS
// (bookings_read_admin); changes go through the website (useWebsiteAdmin).

export const ADMIN_BOOKING_FIELDS =
  "id, kind, status, listing_id, provider_id, starts_at, ends_at, created_at, party_size, total_cents, commission_cents, " +
  "provider_amount_cents, refunded_cents, cancelled_by, payout_due_at, payout_hold, payout_failure, stripe_transfer_id, " +
  "problem_reported_at, problem_resolution, disputed_at, dispute_closed_at, dispute_outcome, reversal_failed_at, customer_name, " +
  "listing:listings(title, kind, status, city:cities(name, timezone)), provider:providers(display_name, status)";

export interface AdminBookingRow {
  id: string;
  kind: "service" | "experience";
  status: string;
  listing_id: string;
  provider_id: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  party_size: number;
  total_cents: number;
  commission_cents: number;
  provider_amount_cents: number;
  refunded_cents: number;
  cancelled_by: string | null;
  payout_due_at: string | null;
  payout_hold: string | null;
  payout_failure: string | null;
  stripe_transfer_id: string | null;
  problem_reported_at: string | null;
  problem_resolution: string | null;
  disputed_at: string | null;
  dispute_closed_at: string | null;
  dispute_outcome: string | null;
  reversal_failed_at: string | null;
  customer_name: string;
  listing: { title: string; kind: string; status: string; city: { name: string; timezone: string } | null } | null;
  provider: { display_name: string; status: string } | null;
}

export const HOLD_LABELS: Record<string, string> = {
  problem_reported: "a reported no-show",
  dispute: "an open dispute",
  refunded: "a refund on the charge",
  provider_suspended: "the provider is suspended",
  account_cannot_receive: "the provider's account can't receive it",
  transfer_failed: "Stripe refused the transfer",
};

const money = (cents: number) => formatMoney(cents, "usd");

/** The payout, in a few words: "Paid $40.00", "Held: an open dispute", "Due Oct 9"… */
export function payoutState(b: AdminBookingRow): string {
  if (b.reversal_failed_at) return `Owed back: ${money(b.provider_amount_cents)}`;
  if (b.status === "paid_out") return `Paid ${money(b.provider_amount_cents)}`;
  if (b.payout_hold) return `Held: ${HOLD_LABELS[b.payout_hold] ?? b.payout_hold}`;
  if (b.status === "cancelled") return b.refunded_cents > 0 ? "None (refunded)" : b.stripe_transfer_id ? "Reversed" : "Due (late cancellation)";
  if (b.status === "completed" || b.status === "confirmed") return b.payout_due_at ? `Due ${formatDate(b.payout_due_at)}` : "After it happens";
  return "None";
}

/** The booking's date and time in its market. */
export function whenOf(b: Pick<AdminBookingRow, "starts_at" | "listing">): string {
  if (!b.starts_at) return "Not set";
  const tz = b.listing?.city?.timezone ?? "America/New_York";
  return `${formatSessionDate(b.starts_at, tz)}, ${formatSessionTime(b.starts_at, tz)}`;
}
