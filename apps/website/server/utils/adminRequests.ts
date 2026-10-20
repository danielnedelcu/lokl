// The owner approves a support member's request (admin roles, step 5b;
// docs/design/admin-roles.md, Requests). Approving runs the same action the
// owner would run directly (adminBookings.ts), as the owner, with the
// request's reason; the action's own database function closes the request
// in the same transaction, so the money has one path and the history names
// both the person who asked and the owner who approved. A refund carries
// the request in its Stripe metadata, so a lost reply finished from Stripe
// closes it too (finishLostCancel).
//
// Plain TypeScript with no Nuxt imports, like adminBookings.ts:
// supabase/tests/app/admin-requests.test.mts runs it against the local
// stack and the Lokl sandbox.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcJson } from "@repo/types";
import { BookingError } from "./bookings";
import { adminCancelBooking, releasePayout, resolveProblemPaid, setProviderStatus } from "./adminBookings";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLOSED: Record<string, string> = {
  declined: "This request was declined.", withdrawn: "This request was withdrawn.",
  expired: "This request expired: it wasn't decided within 7 days.", done_by_owner: "This was already done directly.",
};

/**
 * Approves a pending request as the owner. `expectedAmountCents`: the
 * refund the owner was shown, required for a refund; if what's left of the
 * charge has changed since, nothing is done and the answer says the new
 * amount.
 */
export async function approveRequest(
  db: SupabaseClient, stripe: Stripe, ownerId: string, requestId: string, expectedAmountCents?: number | null,
): Promise<string> {
  const { data, error } = await db.rpc("admin_request_for_approval", { p_admin_id: ownerId, p_request_id: requestId });
  if (error) {
    if (error.code === "42501") throw new BookingError(error.message, 403);
    if (error.code === "P0002") throw new BookingError(error.message, 404);
    throw new Error(error.message);
  }
  const r = rpcJson("admin_request_for_approval", data);
  if (r.status === "approved") return `already approved: ${r.result ?? "done"}`;
  if (r.status !== "pending") throw new BookingError(CLOSED[r.status] ?? "This request isn't waiting for a decision.", 409);
  // A refund is approved for the amount the owner was shown, never blind.
  if (r.kind === "refund" && expectedAmountCents == null) {
    throw new BookingError("Approve a refund from the Requests page, which shows the amount it will refund.", 400);
  }
  if (r.kind === "refund" && expectedAmountCents != null && r.current_amount_cents !== expectedAmountCents) {
    throw new BookingError(
      `The refund is now ${money(r.current_amount_cents ?? 0)}, not the ${money(expectedAmountCents)} you were shown. Check it and approve again.`,
      409,
    );
  }
  const opts = { requestId: r.id };
  switch (r.kind) {
    case "refund":
      return adminCancelBooking(db, stripe, r.booking_id!, ownerId, r.reason, { ...opts, resolveProblem: r.resolve_problem });
    case "release_payout":
      return releasePayout(db, stripe, r.booking_id!, ownerId, r.reason, opts);
    case "resolve_problem_paid":
      return resolveProblemPaid(db, stripe, r.booking_id!, ownerId, r.reason, opts);
    case "suspend_provider":
    case "reinstate_provider":
      return setProviderStatus(db, stripe, r.provider_id!, r.kind === "suspend_provider" ? "suspended" : "active", ownerId, r.reason, r.message, opts);
  }
}
