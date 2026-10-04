import { z } from "zod";
import { contactDetailsMessage } from "./providers";

// Reviews and star ratings (docs/design/reviews.md): the written rules, the
// form schemas, and the words for ratings, shared by the website, the admin
// app and their tests. The database enforces the same limits.

/**
 * The written review rules (public at /review-rules). A review or reply is
 * removed only for one of these; the same list is the report reasons (plus
 * "something else") and the admin's removal reasons. Never for being
 * negative, its stars, or the business disagreeing.
 */
export const REVIEW_RULES = {
  abuse: { title: "Is abusive", text: "Threats, harassment, hate, or insults aimed at a person." },
  private_information: {
    title: "Shares private information",
    text: "Phone numbers, email or home addresses, or another person's full name or personal details. (A first name, like “our guide Marcus”, is fine.)",
  },
  off_topic: { title: "Isn't about the booking", text: "For example about a different business, or about politics or other topics unrelated to it." },
  spam: { title: "Advertises or spams", text: "Links, promotions, or the same text posted again and again." },
  sexual_or_illegal: { title: "Is sexual or describes illegal activity", text: "Sexual content, or anything describing illegal activity." },
  conflict_of_interest: {
    title: "Comes from a conflict of interest",
    text: "The business reviewing itself, or a review written in return for something (a discount, a refund, a gift).",
  },
} as const;
export type ReviewRule = keyof typeof REVIEW_RULES;
export const REVIEW_RULE_KEYS = Object.keys(REVIEW_RULES) as ReviewRule[];
/** Report reasons: the rules, plus "something else". */
export type ReportReason = ReviewRule | "something_else";

/** The words for each number of stars, in the form and for screen readers. */
export const STAR_WORDS = { 1: "Poor", 2: "Fair", 3: "Good", 4: "Very good", 5: "Excellent" } as const;
/** "4 stars: Very good", "1 star: Poor". */
export const starLabel = (n: 1 | 2 | 3 | 4 | 5) => `${n} ${n === 1 ? "star" : "stars"}: ${STAR_WORDS[n]}`;

export const REVIEW_MIN = 20;
export const REVIEW_MAX = 2000;
export const REPLY_MAX = 1500;
/** The average shows from this many reviews; below it, "New on lokl" and the reviews themselves. */
export const RATING_MIN_REVIEWS = 3;

function contactFree(text: string, ctx: z.RefinementCtx) {
  const problem = contactDetailsMessage(text);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
}

export const reviewSchema = z.object({
  rating: z.number({ error: "Choose how many stars to give." }).int().min(1, "Choose how many stars to give.").max(5),
  body: z
    .string()
    .trim()
    .min(REVIEW_MIN, `Write at least ${REVIEW_MIN} characters: a sentence or two about what it was like.`)
    .max(REVIEW_MAX, "Keep it under 2,000 characters.")
    .superRefine(contactFree),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export const replySchema = z.object({
  body: z.string().trim().min(1, "Write your reply.").max(REPLY_MAX, "Keep it under 1,500 characters.").superRefine(contactFree),
});
export type ReplyInput = z.input<typeof replySchema>;

export const reportSchema = z.object({
  rule: z.enum(["abuse", "private_information", "off_topic", "spam", "sexual_or_illegal", "conflict_of_interest", "something_else"], {
    error: "Choose which rule it breaks.",
  }),
  note: z.string().trim().max(1000, "Keep it under 1,000 characters.").optional().default(""),
});
export type ReportInput = z.input<typeof reportSchema>;

// ---------------------------------------------------------------------------
// The words for a rating
// ---------------------------------------------------------------------------

export interface RatingSummary {
  count: number;
  /** One decimal, from the database; null with no reviews. */
  average: number | null;
}

const reviewsWord = (n: number) => `${n} ${n === 1 ? "review" : "reviews"}`;

/**
 * The rating line under a title or name: "New on lokl" (0), "New on lokl ·
 * 2 reviews" (1 or 2), "★ 4.8 · 12 reviews" (3+), with the words for
 * screen readers. `showAverage` is false below 3.
 */
export function ratingLine(r: RatingSummary | null | undefined) {
  const count = r?.count ?? 0;
  if (count === 0) return { showAverage: false, text: "New on lokl", spoken: "New on lokl" };
  if (count < RATING_MIN_REVIEWS || r?.average == null) {
    return { showAverage: false, text: `New on lokl · ${reviewsWord(count)}`, spoken: `New on lokl, ${reviewsWord(count)}` };
  }
  const avg = r.average.toFixed(1);
  return { showAverage: true, text: `${avg} · ${reviewsWord(count)}`, spoken: `Rated ${avg} out of 5 from ${reviewsWord(count)}` };
}

/** A listing card's "★ 4.8 (12)", from 3 reviews; null below. */
export function cardRating(r: RatingSummary | null | undefined) {
  if (!r || r.count < RATING_MIN_REVIEWS || r.average == null) return null;
  const avg = r.average.toFixed(1);
  return { text: `${avg} (${r.count})`, spoken: `Rated ${avg} out of 5 from ${reviewsWord(r.count)}` };
}

/** One review's stars for screen readers: "4 out of 5 stars". */
export const reviewStarsSpoken = (n: number) => `${n} out of 5 stars`;

/**
 * The breakdown at the top of a Reviews section (from 3 reviews): each star
 * level, 5 down to 1, with its count and share, and the words for screen
 * readers ("5 stars: 8 reviews, 67%"). Shares are rounded on their own, so
 * they may not add up to exactly 100.
 */
export function ratingBreakdown(stars: [number, number, number, number, number], count: number) {
  return ([5, 4, 3, 2, 1] as const).map((level) => {
    const n = stars[level - 1] ?? 0;
    const percent = count > 0 ? Math.round((n / count) * 100) : 0;
    return {
      level,
      count: n,
      percent,
      spoken: `${level} ${level === 1 ? "star" : "stars"}: ${reviewsWord(n)}, ${percent}%`,
    };
  });
}

/** "Booked October 2026", from the review's booking month (yyyy-mm-01). */
export function bookedLabel(bookingMonth: string) {
  const [y, m] = bookingMonth.split("-").map(Number);
  const month = new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `Booked ${month} ${y}`;
}

/** Why a booking can't be reviewed (review_state().why_not), in plain words. */
export function whyNoReview(why: string | null, windowEndsAt: string | null, formatDate: (iso: string) => string): string | null {
  switch (why) {
    case "window_closed":
      return windowEndsAt ? `Reviews closed on ${formatDate(windowEndsAt)}: they're open for 14 days after a booking.` : "Reviews close 14 days after a booking.";
    case "report_open":
      return "You can review this once lokl has looked at the problem you reported.";
    case "not_completed":
      return "You can review this once the booking is marked complete, shortly after it ends.";
    default:
      return null;
  }
}

/**
 * A database refusal on a review, reply or report, in plain words (the form
 * checks first, so these are the cases it can't see).
 */
export function reviewProblem(error: { code?: string; message?: string } | null, what: "review" | "reply" | "report"): string {
  const m = error?.message ?? "";
  if (error?.code === "23505") {
    return what === "report" ? "You've already reported this." : what === "reply" ? "There's already a reply to this review." : "You've already reviewed this booking.";
  }
  if (error?.code === "23514") {
    if (/contact_details/.test(m)) return "Take out the phone number, email or web address: reviews and replies can't include contact details.";
    if (/length/.test(m)) return what === "reply" ? "Write your reply, in under 1,500 characters." : `Write between ${REVIEW_MIN} and 2,000 characters.`;
  }
  if (error?.code === "42501") {
    if (what === "report") return "This can't be reported: it may have been removed, or it's your own review.";
    if (what === "reply") return "You can't reply to this review now: it may have been removed.";
    return "This booking can't be reviewed now: reviews are open for 14 days after a completed booking.";
  }
  return `Your ${what} wasn't saved. Check your connection and try again.`;
}
