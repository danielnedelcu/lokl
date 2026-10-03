// What a suspended provider may still do (decided 2026-10-03). Suspension
// hides their listings and stops new business, but they must still be able
// to sign in, see their bookings and cancel confirmed ones (with the usual
// full refund), so customers aren't left with bookings nobody will honour.
// Everything else (answering requests, listings, sessions, Stripe setup)
// stays refused. Plain TypeScript, so supabase/tests/app/admin-actions.test.mts
// can check the list.
export type ProviderAction =
  | "view_bookings" | "cancel_bookings"
  | "answer_requests" | "edit_listings" | "manage_payouts" | "other";

const ALLOWED_WHILE_SUSPENDED: ReadonlySet<ProviderAction> = new Set(["view_bookings", "cancel_bookings"]);

export function providerMay(status: string, action: ProviderAction): boolean {
  if (status === "active") return true;
  return status === "suspended" && ALLOWED_WHILE_SUSPENDED.has(action);
}
