import { z } from "zod";

// What the booking forms send (docs/design/booking-and-checkout.md,
// docs/design/service-availability.md). The database checks the same rules
// again (create_service_booking, reserve_experience_booking); these give the
// customer plain messages first.

const name = z.string().trim().min(1, "Enter your name.").max(120, "Keep your name under 120 characters.");
const phone = z
  .string()
  .trim()
  .max(30, "Keep the phone number under 30 characters.")
  .refine((v) => v === "" || /^[0-9+()\-.\s]{7,30}$/.test(v), "Enter a phone number, or leave it empty.")
  .optional();
const notes = z.string().trim().max(1000, "Keep your notes under 1,000 characters.").optional();

export const bookingAddressSchema = z.object({
  line1: z.string().trim().min(3, "Enter the street address.").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, "Enter the city.").max(80),
  state: z.string().trim().regex(/^[A-Z]{2}$/, "Use the two-letter state, like GA."),
  postal_code: z.string().trim().regex(/^[0-9]{5}(-[0-9]{4})?$/, "Enter a five-digit zip code."),
  instructions: z.string().trim().max(500).optional(),
});

/** create_service_booking's refusal when the slot was taken (or closed) meanwhile. */
export const SLOT_TAKEN = "That time isn't available. Pick another.";

export const serviceBookingRequestSchema = z.object({
  listingId: z.uuid(),
  /** The slot chosen in the scheduling panel (one of service_slots). */
  startsAt: z.iso.datetime({ offset: true, error: "Choose a time." }),
  name,
  phone,
  notes,
  address: bookingAddressSchema.optional(),
  /** The page's key for this checkout attempt: a retry with it never makes a second booking. */
  checkoutKey: z.uuid().optional(),
});
export type ServiceBookingRequest = z.infer<typeof serviceBookingRequestSchema>;

/** The most people one Experience booking can be for. */
export const PARTY_SIZE_MAX = 10;
/** How long a checkout holds the spots or the time while the customer pays (Stripe's shortest expiry). */
export const CHECKOUT_HOLD_MINUTES = 30;
/** An Approve request: the provider answers within this many hours of the card being held... */
export const ANSWER_WITHIN_HOURS = 48;
/** ...and at least this many hours before it starts, whichever comes first (the database's bookings guard). */
export const ANSWER_BEFORE_START_HOURS = 2;
/** The provider's share is sent this many hours after a booking ends (payout_due_at, booking_cancellations migration). */
export const PAYOUT_AFTER_END_HOURS = 24;
/** A weekly series of Experience sessions runs for 2 to this many weeks. */
export const SESSION_SERIES_MAX_WEEKS = 12;

export const experienceBookingRequestSchema = z.object({
  sessionId: z.uuid(),
  partySize: z.coerce.number().int().min(1, "Book at least 1 spot.").max(PARTY_SIZE_MAX, `Book up to ${PARTY_SIZE_MAX} people at a time.`),
  name,
  phone,
  notes,
  /** The page's key for this checkout attempt: a retry with it never makes a second booking. */
  checkoutKey: z.uuid().optional(),
});
export type ExperienceBookingRequest = z.infer<typeof experienceBookingRequestSchema>;

// ---------------------------------------------------------------------------
// The cancellation policy (decision 5, with the 1-hour grace period decided
// 2026-10-02). One function, so what a customer is told before cancelling is
// exactly what the server does; bookings_guard enforces the same rules.
// ---------------------------------------------------------------------------

export const FREE_CANCEL_BEFORE_MS = 48 * 60 * 60 * 1000;
export const GRACE_AFTER_BOOKING_MS = 60 * 60 * 1000;

export type CustomerCancelOutcome =
  /** A Service request not yet accepted: the hold is released, nothing was charged. */
  | { kind: "release" }
  /**
   * 48 hours or more ahead, or within the hour after booking: everything back.
   * graceEndsAt: when the grace period ends, an hour after booking or at the
   * start, whichever comes first; graceEndsAtStart says which.
   */
  | { kind: "full_refund"; reason: "ahead" | "grace"; graceEndsAt?: string; graceEndsAtStart?: boolean }
  /** Within 48 hours, after the grace hour: no refund. */
  | { kind: "no_refund" }
  /** Started, already over, or not cancellable. */
  | { kind: "not_allowed"; why: string };

export function customerCancelOutcome(
  b: { status: string; starts_at: string | null; confirmed_at: string | null },
  now = Date.now(),
): CustomerCancelOutcome {
  if (b.status === "requested") return { kind: "release" };
  if (b.status !== "confirmed" || !b.starts_at) return { kind: "not_allowed", why: "This booking can't be cancelled." };
  const start = Date.parse(b.starts_at);
  if (now >= start) return { kind: "not_allowed", why: "This booking has started, so it can't be cancelled." };
  if (now <= start - FREE_CANCEL_BEFORE_MS) return { kind: "full_refund", reason: "ahead" };
  // The grace hour ends at the start if that comes sooner (booked at 4:18 PM
  // for 4:45 PM: free until 4:45 PM, not 5:18 PM; found 2026-10-02).
  const hourAfter = b.confirmed_at ? Date.parse(b.confirmed_at) + GRACE_AFTER_BOOKING_MS : 0;
  const graceEnds = Math.min(hourAfter, start);
  if (now <= hourAfter) {
    return { kind: "full_refund", reason: "grace", graceEndsAt: new Date(graceEnds).toISOString(), graceEndsAtStart: graceEnds === start };
  }
  return { kind: "no_refund" };
}

/** When "The provider didn't show up" can be reported: from the start until the payout. */
export function canReportProblem(
  b: { status: string; starts_at: string | null; payout_due_at: string | null; problem_reported_at: string | null },
  now = Date.now(),
) {
  return (
    (b.status === "confirmed" || b.status === "completed") &&
    !b.problem_reported_at &&
    !!b.starts_at && now >= Date.parse(b.starts_at) &&
    !!b.payout_due_at && now < Date.parse(b.payout_due_at)
  );
}
