// The words for ratings (packages/types/src/reviews.ts; docs/design/reviews.md):
// the rating line at 0, 2 and 3+ reviews, the card's "★ 4.8 (12)" from 3,
// the breakdown's spoken rows, the star labels, and the form's messages.
// Run: npx tsx packages/ui/tests/review-ratings.test.mts (part of `npm run test:ui`).
import { bookedLabel, cardRating, ratingBreakdown, ratingLine, reviewProblem, reviewSchema, starLabel } from "../../types/src/reviews";

let failures = 0;
const check = (ok: boolean, name: string, got?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
};

let l = ratingLine({ count: 0, average: null });
check(l.text === "New on lokl" && !l.showAverage, "1. no reviews: New on lokl", l);
l = ratingLine({ count: 2, average: 5 });
check(l.text === "New on lokl · 2 reviews" && l.spoken === "New on lokl, 2 reviews" && !l.showAverage, "2. two reviews: no average yet", l);
l = ratingLine({ count: 1, average: 4 });
check(l.spoken === "New on lokl, 1 review", "3. one review, singular", l);
l = ratingLine({ count: 12, average: 4.8 });
check(l.showAverage && l.text === "4.8 · 12 reviews" && l.spoken === "Rated 4.8 out of 5 from 12 reviews", "4. from three: the average, in words", l);
check(ratingLine({ count: 3, average: 5 }).text === "5.0 · 3 reviews", "5. a whole number shows one decimal");
check(cardRating({ count: 2, average: 5 }) === null, "6. cards: nothing below 3");
const c = cardRating({ count: 12, average: 4.8 });
check(c?.text === "4.8 (12)" && c.spoken === "Rated 4.8 out of 5 from 12 reviews", "7. cards: 4.8 (12), in words", c);
const b = ratingBreakdown([0, 0, 0, 4, 8], 12);
check(b.map((r) => r.level).join() === "5,4,3,2,1", "8. the breakdown runs 5 down to 1");
check(b[0]!.spoken === "5 stars: 8 reviews, 67%" && b[1]!.spoken === "4 stars: 4 reviews, 33%", "9. each row in words, with its share", b);
check(b[4]!.spoken === "1 star: 0 reviews, 0%", "10. ...singular star, none", b[4]);
check(ratingBreakdown([0, 0, 1, 0, 0], 1)[2]!.spoken === "3 stars: 1 review, 100%", "11. ...singular review");
check(starLabel(1) === "1 star: Poor" && starLabel(4) === "4 stars: Very good" && starLabel(5) === "5 stars: Excellent", "12. star labels in words");
check(bookedLabel("2026-10-01") === "Booked October 2026", "13. the booking month");
check(!reviewSchema.safeParse({ rating: 4, body: "Too short." }).success, "14. the form wants 20 characters");
const contact = reviewSchema.safeParse({ rating: 4, body: "Lovely walk, email me at sam@example.com for tips." });
check(!contact.success && /email address/.test(contact.error.issues[0]!.message), "15. ...and no contact details", contact.success ? null : contact.error.issues[0]);
check(!reviewSchema.safeParse({ rating: 0, body: "A perfectly good review of the walk." }).success, "16. ...and a rating");
check(reviewProblem({ code: "23505" }, "review") === "You've already reviewed this booking.", "17. already reviewed, in words");
check(/14 days/.test(reviewProblem({ code: "42501" }, "review")), "18. refused: says reviews are open 14 days");

if (failures) {
  console.error(`${failures} review rating check(s) failed.`);
  process.exit(1);
}
console.log("All review rating checks passed.");
