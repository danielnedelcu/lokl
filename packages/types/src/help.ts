import {
  ANSWER_BEFORE_START_HOURS, ANSWER_WITHIN_HOURS, CHECKOUT_HOLD_MINUTES, FREE_CANCEL_BEFORE_MS, GRACE_AFTER_BOOKING_MS,
  PARTY_SIZE_MAX, PAYOUT_AFTER_END_HOURS, SESSION_SERIES_MAX_WEEKS,
} from "./bookings";
import { REPLY_MAX, REVIEW_MAX, REVIEW_MIN, REVIEW_WINDOW_DAYS, RATING_MIN_REVIEWS, TOP_RATED } from "./reviews";
import { SCHEDULE_CHOICES, SCHEDULE_DEFAULTS, durationWords } from "./availability";
import { MAX_SEARCH_DAYS } from "./search";
import { SUPPORT_REOPEN_DAYS } from "./support";

// The facts the Help centre's articles name (docs/design/website-pages.md):
// an article writes {{CANCEL_FREE_BEFORE}}, never "48 hours", so it can't
// drift from what the code does. Each comes from the shared constant the
// code itself uses; the few that only the database or Supabase settings
// enforce say where. An article naming a fact that isn't here fails the
// help tests (packages/ui/tests/help-articles.test.mts).

const hours = (n: number) => `${n} ${n === 1 ? "hour" : "hours"}`;
// Durations in the same words as the availability settings' menus.
const minutes = (n: number) => durationWords(n);
const list = (xs: readonly (string | number)[]) => (xs.length < 2 ? String(xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
const number = (n: number) => n.toLocaleString("en-US");

export const HELP_FACTS: Record<string, string> = {
  // Cancellations (customerCancelOutcome; the bookings guard).
  CANCEL_FREE_BEFORE: hours(FREE_CANCEL_BEFORE_MS / 3_600_000),
  CANCEL_GRACE: hours(GRACE_AFTER_BOOKING_MS / 3_600_000),
  // Booking.
  PARTY_SIZE_MAX: String(PARTY_SIZE_MAX),
  CHECKOUT_HOLD: minutes(CHECKOUT_HOLD_MINUTES),
  ANSWER_WITHIN: hours(ANSWER_WITHIN_HOURS),
  ANSWER_BEFORE_START: hours(ANSWER_BEFORE_START_HOURS),
  // An Approve slot is at least this far ahead (service_open_days migration: greatest(notice, 4 hours)).
  APPROVE_MIN_AHEAD: hours(4),
  PAYOUT_AFTER_END: hours(PAYOUT_AFTER_END_HOURS),
  NO_SHOW_REPORT_UNTIL: `${hours(PAYOUT_AFTER_END_HOURS)} after it ends`,
  // Reviews.
  REVIEW_WINDOW: `${REVIEW_WINDOW_DAYS} days`,
  REVIEW_MIN: String(REVIEW_MIN),
  REVIEW_MAX: number(REVIEW_MAX),
  REPLY_MAX: number(REPLY_MAX),
  RATING_MIN_REVIEWS: String(RATING_MIN_REVIEWS),
  TOP_RATED_AVERAGE: String(TOP_RATED.minAverage),
  TOP_RATED_REVIEWS: String(TOP_RATED.minReviews),
  // Availability (the booking settings' choices).
  BOOKING_WINDOW_RANGE: `${SCHEDULE_CHOICES.booking_window_days[0]} to ${SCHEDULE_CHOICES.booking_window_days.at(-1)} days`,
  BOOKING_WINDOW_DEFAULT: `${SCHEDULE_DEFAULTS.booking_window_days} days`,
  NOTICE_RANGE: `${minutes(SCHEDULE_CHOICES.min_notice_minutes[0])} to ${minutes(SCHEDULE_CHOICES.min_notice_minutes.at(-1)!)}`,
  NOTICE_DEFAULT: minutes(SCHEDULE_DEFAULTS.min_notice_minutes),
  SLOT_INTERVALS: `${list(SCHEDULE_CHOICES.slot_interval_minutes)} minutes`,
  BUFFER_MAX: minutes(SCHEDULE_CHOICES.default_buffer_minutes.at(-1)!),
  SESSION_SERIES_WEEKS: `2 to ${SESSION_SERIES_MAX_WEEKS} weeks`,
  // Search, saving, sign-in and reports.
  SEARCH_DAYS_MAX: `${MAX_SEARCH_DAYS} days`,
  // saved_items migration: at most 500 of each per customer.
  SAVED_MAX: "500",
  // supabase/config.toml otp_expiry (and the hosted project's setting): 600 seconds.
  SIGN_IN_CODE_LASTS: "10 minutes",
  SUPPORT_REOPEN: `${SUPPORT_REOPEN_DAYS} days`,
};

/**
 * Facts known only when a page is served, not when the site is built: the
 * information pages ask for them by these names, and the page supplies them
 * (the Fees page reads the commission rates live; Contact the support
 * address; About counts Atlanta's categories and neighbourhoods live, so
 * its numbers are always the database's). The help tests accept these names.
 */
export const PAGE_FACTS = ["COMMISSION_SERVICE", "COMMISSION_EXPERIENCE", "SUPPORT_EMAIL", "MARKET_CATEGORIES", "MARKET_NEIGHBORHOODS"] as const;
export type PageFact = (typeof PAGE_FACTS)[number];

/**
 * The About page's live numbers show once Atlanta has at least this many
 * categories and this many neighborhoods (decided 2026-10-18): a smaller
 * number is true but reads as thin. Below it, the sentence is left out.
 */
export const MARKET_COUNTS_MIN = 5;

/**
 * "14 categories" and "25 neighborhoods" for the About page, or null for
 * both (the sentence is left out) while either is below MARKET_COUNTS_MIN.
 */
export function marketCountFacts(categories: number, neighborhoods: number): Record<"MARKET_CATEGORIES" | "MARKET_NEIGHBORHOODS", string | null> {
  if (categories < MARKET_COUNTS_MIN || neighborhoods < MARKET_COUNTS_MIN) return { MARKET_CATEGORIES: null, MARKET_NEIGHBORHOODS: null };
  const count = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}`;
  return { MARKET_CATEGORIES: count(categories, "categories"), MARKET_NEIGHBORHOODS: count(neighborhoods, "neighborhoods") };
}

/**
 * "{{CANCEL_FREE_BEFORE}}" in an article becomes "48 hours"; an unknown name
 * is listed, never left in. `extra`: facts the page supplies (PAGE_FACTS).
 */
export function fillHelpFacts(text: string, extra: Partial<Record<PageFact, string>> = {}): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const filled = text.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    if (name in extra) return extra[name as PageFact]!;
    if (name in HELP_FACTS) return HELP_FACTS[name]!;
    unknown.push(name);
    return "";
  });
  return { text: filled, unknown };
}
