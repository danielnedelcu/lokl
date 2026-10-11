// Market times (packages/ui/app/utils/zonedTime.ts and formatDate.ts), the
// cases the time-zone guard named (2026-10-10): late at night in Atlanta
// (already tomorrow in UTC), the clock change in both directions, a month
// that starts in Atlanta, and formatters that take the zone they're given,
// whatever zone this process runs in (the test runs it in Tokyo too).
// Run: npx tsx packages/ui/tests/zoned-time.test.mts (part of `npm run test:ui`).
import { instantToZoned, monthStartIn, todayIn, weeklyInstants, zonedToInstant, formatSessionDate, formatSessionTime } from "../app/utils/zonedTime";
import { formatDate, formatDateTime, formatHomeDateTime } from "../app/utils/formatDate";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const ATL = "America/New_York";
const iso = (s: string) => new Date(s).toISOString();

// 1. Late at night in Atlanta: 11:30 PM on Oct 14 is 03:30 UTC on Oct 15.
const late = zonedToInstant({ date: "2026-10-14", time: "23:30" }, ATL);
check(iso(late) === "2026-10-15T03:30:00.000Z", "1a. 11:30 PM Atlanta on Oct 14 is 03:30 UTC on Oct 15");
check(JSON.stringify(instantToZoned(late, ATL)) === JSON.stringify({ date: "2026-10-14", time: "23:30" }), "1b. ...and reads back as Oct 14, 23:30 in Atlanta");
check(formatSessionDate(late, ATL) === "Wed, Oct 14" && formatSessionTime(late, ATL) === "11:30 PM", "1c. it's shown as Wed, Oct 14, 11:30 PM");
check(todayIn(ATL, late) === "2026-10-14", "1d. 'today' in Atlanta is still Oct 14");
check(formatDate(late, ATL) === "Oct 14, 2026" && formatDateTime(late, ATL) === "Oct 14, 2026, 11:30 PM", "1e. formatDate and formatDateTime use the zone given");
check(formatDate(late, "Asia/Tokyo") === "Oct 15, 2026", "1f. ...and in Tokyo it's already Oct 15");
check(formatHomeDateTime(late) === "Oct 14, 2026, 11:30 PM Atlanta time", "1g. the admin's record times are labelled Atlanta time");

// 2. The clock change, November: a weekly 10:00 AM series stays at 10:00 AM.
const series = weeklyInstants({ date: "2026-10-25", time: "10:00" }, 3, ATL); // Nov 1 is the change
check(series.map((s) => instantToZoned(s, ATL).time).every((t) => t === "10:00"), "2a. a weekly 10:00 AM series across the November change stays at 10:00 AM");
check(iso(series[0]!) === "2026-10-25T14:00:00.000Z" && iso(series[1]!) === "2026-11-01T15:00:00.000Z", "2b. ...14:00 UTC before the change, 15:00 UTC after");
// The repeated hour: 1:30 AM on Nov 1 happens twice; it's read as the first.
check(iso(zonedToInstant({ date: "2026-11-01", time: "01:30" }, ATL)) === "2026-11-01T05:30:00.000Z", "2c. 1:30 AM on the November change day is the first one (EDT)");

// 3. The clock change, March: 2:30 AM doesn't exist; it moves an hour later.
const skipped = zonedToInstant({ date: "2027-03-14", time: "02:30" }, ATL);
check(instantToZoned(skipped, ATL).time === "03:30", "3. 2:30 AM on the March change day becomes 3:30 AM, like a phone's clock");

// 4. The month starts in Atlanta, not on the device.
check(iso(monthStartIn(ATL, "2026-11-01T03:30:00Z")) === "2026-10-01T04:00:00.000Z", "4a. at 11:30 PM on Oct 31 in Atlanta, the month began Oct 1 (Atlanta midnight)");
check(iso(monthStartIn(ATL, "2026-11-01T05:00:00Z")) === "2026-11-01T04:00:00.000Z", "4b. an hour and a half later it's November, from Atlanta midnight (still EDT)");
check(iso(monthStartIn(ATL, "2026-12-15T12:00:00Z")) === "2026-12-01T05:00:00.000Z", "4c. December begins at 05:00 UTC (EST)");

console.log(failures ? `${failures} failed` : "All zoned time checks passed.");
process.exit(failures ? 1 : 0);
