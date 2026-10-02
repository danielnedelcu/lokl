// Sample bookings for every booking email and variant, for the template
// test and `npm run email:previews`. Made-up people and places only.
import type { EmailContext, EmailKind } from "../../../apps/website/server/utils/bookingEmailTemplates";

const H = 3600_000;
export const SAMPLE_NOW = Date.parse("2026-10-06T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function ctx(kind: "service" | "experience", over: Partial<EmailContext["booking"]> = {}): EmailContext {
  const start = SAMPLE_NOW + 4 * 24 * H;
  return {
    siteUrl: "http://localhost:3100",
    booking: {
      id: "00000000-0000-4000-8000-000000000001",
      kind,
      status: "confirmed",
      starts_at: iso(start),
      confirmed_at: iso(SAMPLE_NOW),
      respond_by: iso(SAMPLE_NOW + 48 * H),
      preferred_times: kind === "service" ? [iso(start), iso(start + 24 * H), iso(start + 50 * H)] : null,
      party_size: kind === "experience" ? 2 : 1,
      total_cents: kind === "experience" ? 13000 : 4500,
      provider_amount_cents: kind === "experience" ? 10400 : 3960,
      refunded_cents: 0,
      cancelled_by: null,
      status_changed_by: "stripe",
      customer_name: "Jordan Example",
      ...over,
    },
    listing: kind === "experience"
      ? { title: "Sweet Auburn food walk", kind, categorySlug: "food-and-drink", marketSlug: "atlanta", marketName: "Atlanta", timezone: "America/New_York" }
      : { title: "Silk press and trim", kind, categorySlug: "hair-and-beauty", marketSlug: "atlanta", marketName: "Atlanta", timezone: "America/New_York" },
    provider: { name: kind === "experience" ? "Peach State Walks" : "Fresh Cuts Studio" },
  };
}

export interface Sample { kind: EmailKind; variant: string; ctx: EmailContext }

export function emailSamples(): Sample[] {
  const start = SAMPLE_NOW + 4 * 24 * H;
  const soon = SAMPLE_NOW + 30 * H; // booked inside 48 hours: the grace hour applies
  const longAgo = iso(SAMPLE_NOW - 5 * 24 * H);
  const req = { starts_at: null, confirmed_at: null };
  return [
    { kind: "customer_request_sent", variant: "", ctx: ctx("service", { status: "requested", ...req }) },
    { kind: "customer_request_accepted", variant: "accepted well ahead", ctx: ctx("service") },
    { kind: "customer_request_accepted", variant: "accepted inside 48 hours (grace hour)", ctx: ctx("service", { starts_at: iso(soon) }) },
    { kind: "customer_request_declined", variant: "by the provider", ctx: ctx("service", { status: "declined", ...req, status_changed_by: "provider" }) },
    { kind: "customer_request_declined", variant: "the listing came down", ctx: ctx("service", { status: "declined", ...req, status_changed_by: "system" }) },
    { kind: "customer_request_expired", variant: "no answer", ctx: ctx("service", { status: "expired", ...req, status_changed_by: "system" }) },
    { kind: "customer_request_expired", variant: "card couldn't be charged", ctx: ctx("service", { status: "expired", ...req, status_changed_by: "provider" }) },
    { kind: "customer_booking_confirmed", variant: "booked well ahead", ctx: ctx("experience") },
    { kind: "customer_booking_confirmed", variant: "booked inside 48 hours (grace hour)", ctx: ctx("experience", { starts_at: iso(soon) }) },
    { kind: "customer_booking_confirmed", variant: "booked less than an hour before the start", ctx: ctx("experience", { starts_at: iso(SAMPLE_NOW + 27 * 60_000) }) },
    { kind: "customer_booking_cancelled", variant: "you cancelled a request", ctx: ctx("service", { status: "cancelled", cancelled_by: "customer", ...req }) },
    { kind: "customer_booking_cancelled", variant: "you cancelled, refunded", ctx: ctx("experience", { status: "cancelled", cancelled_by: "customer", refunded_cents: 13000 }) },
    { kind: "customer_booking_cancelled", variant: "you cancelled, no refund", ctx: ctx("experience", { status: "cancelled", cancelled_by: "customer", starts_at: iso(soon), confirmed_at: longAgo }) },
    { kind: "customer_booking_cancelled", variant: "the provider cancelled", ctx: ctx("experience", { status: "cancelled", cancelled_by: "provider", refunded_cents: 13000 }) },
    { kind: "customer_booking_cancelled", variant: "lokl cancelled", ctx: ctx("experience", { status: "cancelled", cancelled_by: "admin", refunded_cents: 13000 }) },
    { kind: "customer_problem_received", variant: "", ctx: ctx("experience", { starts_at: iso(SAMPLE_NOW - 2 * H) }) },
    { kind: "provider_new_request", variant: "", ctx: ctx("service", { status: "requested", ...req }) },
    { kind: "provider_new_booking", variant: "", ctx: ctx("experience") },
    { kind: "provider_booking_cancelled", variant: "customer withdrew a request", ctx: ctx("service", { status: "cancelled", cancelled_by: "customer", ...req }) },
    { kind: "provider_booking_cancelled", variant: "customer cancelled in time", ctx: ctx("experience", { status: "cancelled", cancelled_by: "customer", refunded_cents: 13000 }) },
    { kind: "provider_booking_cancelled", variant: "customer cancelled late", ctx: ctx("experience", { status: "cancelled", cancelled_by: "customer", starts_at: iso(soon), confirmed_at: longAgo }) },
    { kind: "provider_booking_cancelled", variant: "lokl cancelled", ctx: ctx("experience", { status: "cancelled", cancelled_by: "admin", refunded_cents: 13000 }) },
    { kind: "provider_request_unanswered", variant: "", ctx: ctx("service", { status: "expired", ...req, status_changed_by: "system" }) },
    { kind: "provider_payout_sent", variant: "", ctx: ctx("experience", { status: "paid_out", starts_at: iso(start - 6 * 24 * H) }) },
    { kind: "provider_problem_reported", variant: "", ctx: ctx("experience", { starts_at: iso(SAMPLE_NOW - 2 * H) }) },
    { kind: "provider_payout_problem", variant: "", ctx: ctx("experience", { status: "completed", starts_at: iso(start - 6 * 24 * H) }) },
  ];
}
