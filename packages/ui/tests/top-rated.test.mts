// isTopRated (@repo/types): "Top rated" is 4.8 or higher from at least 5
// published reviews, worked out exactly from the counts at each star level,
// never from the stored average (rounded to one decimal, so 4.79 is "4.8").
// Run: npx tsx packages/ui/tests/top-rated.test.mts
import { TOP_RATED, isTopRated } from "../../types/src/reviews";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
// [1 star, 2, 3, 4, 5 stars]
check(TOP_RATED.minAverage === 4.8 && TOP_RATED.minReviews === 5, "0. the thresholds: 4.8 from 5 reviews");
check(isTopRated([0, 0, 0, 1, 4]) === true, "1. 4.8 from 5 reviews (four 5s and a 4) is top rated");
check(isTopRated([0, 0, 0, 0, 5]) === true, "2. 5.0 from 5 reviews is top rated");
check(isTopRated([0, 0, 0, 21, 79]) === false, "3. 4.79 from 100 reviews (stored as 4.8) isn't");
check(isTopRated([0, 0, 0, 0, 4]) === false, "4. 5.0 from only 4 reviews isn't");
check(isTopRated([0, 0, 1, 0, 4]) === false, "5. 4.6 from 5 reviews isn't");
check(isTopRated([0, 0, 0, 0, 0]) === false, "6. no reviews isn't");
check(isTopRated([0, 0, 0, 20, 80]) === true, "7. exactly 4.8 from 100 reviews is");
console.log(failures ? `${failures} failed` : "All top rated checks passed.");
process.exit(failures ? 1 : 0);
