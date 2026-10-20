// The clock sweep (decided 2026-10-18): lokl's time rules, checked relative
// to TEST_NOW, an instant (default: now). `npm run test:clock` runs it at
// each instant that has broken a test or could (scripts/test-clock.mjs):
// Friday 3:30 PM, Saturday 11:30 PM and Sunday 8:30 AM in Atlanta, a minute
// before midnight at the end of a month and a year, November's repeated
// hour (both 1:30s) and March's skipped one.
//
// Only code that takes the time can be moved to an instant: these pure
// rules, the servers' `now` parameters, and the browser's clock. The
// database's now() can't, so the real-clock tests run at these times in the
// scheduled Clock sweep workflow instead (.github/workflows/clock-sweep.yml).
// Run: TEST_NOW=2026-10-23T19:30:00Z npx tsx packages/ui/tests/clock-sweep.test.mts
// or TEST_INSTANTS=all for every instant in scripts/clock-instants.mjs (the
// named edges and every hour of four days, 2026-10-19): only failures are
// printed then, each with its instant.
import { CONTACT_ACCESS_DAYS, contactAccessEnded, customerCancelOutcome, FREE_CANCEL_BEFORE_MS, GRACE_AFTER_BOOKING_MS, repeatedHourZone } from "@repo/types";
import { addDays, dayRangeInstants, formatSessionTime, instantToZoned, monthStartIn, quickDates, todayIn, zonedToInstant } from "../app/utils/zonedTime";
import { ALL } from "../../../scripts/clock-instants.mjs";

let failures = 0;
let passed = 0;
let quiet = false;
let where = "";
const check = (ok: boolean, name: string) => {
  if (!quiet || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${name}${quiet ? ` (${where})` : ""}`);
  if (ok) passed++;
  else failures++;
};
const ATL = "America/New_York";
const iso = (t: number) => new Date(t).toISOString();
// The Atlanta calendar day and weekday of an instant, worked out here with Intl alone.
const atlDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: ATL }).format(new Date(t));
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // a calendar date's own weekday, 0 Sunday
const wall = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: ATL, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

/** Every check, relative to the instant `now`. */
function checksAt(now: number) {
  const at = iso(now);
  if (!quiet) console.log(`(at ${at}: ${atlDay(now)} ${wall(now)} in Atlanta)`);

  // 1. Today, and the month it's in, are Atlanta's.
  const today = todayIn(ATL, at);
  check(today === atlDay(now), `1a. today in Atlanta is ${atlDay(now)}`);
  const monthStart = monthStartIn(ATL, at);
  check(instantToZoned(monthStart, ATL).date === `${today.slice(0, 7)}-01` && instantToZoned(monthStart, ATL).time === "00:00" && Date.parse(monthStart) <= now,
    "1b. this month began at Atlanta midnight on the 1st, before now");

  // 2. The search bar's quick dates: tomorrow, and a weekend that hasn't ended.
  const q = quickDates(ATL, at);
  check(q.today === today && q.tomorrow === addDays(today, 1), "2a. Today and Tomorrow are Atlanta's");
  const w = q.weekend;
  const days = w.from === w.to ? [w.from] : [w.from, w.to];
  check(days.every((d) => [0, 6].includes(weekday(d))) && w.from >= today && (w.to === w.from || w.to === addDays(w.from, 1)),
    `2b. This weekend is a Saturday and Sunday from today (${w.from} to ${w.to})`);
  check([0, 6].includes(weekday(today)) ? w.from === today : weekday(w.from) === 6 && Date.parse(`${w.from}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) <= 6 * 864e5,
    "2c. ...today, if it's the weekend; otherwise the coming Saturday");

  // 3. Wall-clock times and their instants round-trip, and a time that
  // happens twice is labelled and read as the first (decided 2026-10-18).
  const local = instantToZoned(at, ATL);
  const back = Date.parse(zonedToInstant(local, ATL));
  const repeated = wall(now - 3_600_000) === wall(now) || wall(now + 3_600_000) === wall(now);
  const second = wall(now - 3_600_000) === wall(now);
  const sameMinute = Math.floor(now / 60_000) * 60_000;
  check(second ? back === sameMinute - 3_600_000 : back === sameMinute,
    `3a. ${local.date} ${local.time} in Atlanta reads back as ${second ? "the first of its two times (an hour earlier)" : "this instant"}`);
  const label = repeatedHourZone(at, ATL);
  check(repeated ? /^ E[DS]T$/.test(label) && label === (second ? " EST" : " EDT") : label === "",
    `3b. ${repeated ? `in the repeated hour, labelled${label}` : "an ordinary time, with no zone label"}`);
  check(formatSessionTime(at, ATL).endsWith(label) && (label === "" || formatSessionTime(at, ATL).includes(" AM")),
    "3c. ...and shown that way");

  // 4. Free cancellation, at its edges from now (48 hours before the start;
  // within the hour after booking; never once it's started).
  const HOUR = 3_600_000;
  const outcome = (startsIn: number, bookedAgo: number) =>
    customerCancelOutcome({ status: "confirmed", starts_at: iso(now + startsIn), confirmed_at: iso(now - bookedAgo) }, now).kind;
  check(outcome(FREE_CANCEL_BEFORE_MS, 10 * HOUR) === "full_refund" && outcome(FREE_CANCEL_BEFORE_MS - 1, 10 * HOUR) === "no_refund",
    "4a. free until exactly 48 hours before the start, not a millisecond after");
  check(outcome(5 * HOUR, GRACE_AFTER_BOOKING_MS) === "full_refund" && outcome(5 * HOUR, GRACE_AFTER_BOOKING_MS + 1) === "no_refund",
    "4b. free for exactly the hour after booking, inside 48 hours");
  check(outcome(0, 0) === "not_allowed" && outcome(1, 0) === "full_refund", "4c. not once it's started; just before, still free (booked just now)");

  // 5. A provider sees the customer's details until 30 days after the booking
  // ends (the database's rule; contactAccessEnded words the page).
  const ACCESS = CONTACT_ACCESS_DAYS * 864e5;
  const ended = (endedAgo: number) => contactAccessEnded({ starts_at: iso(now - endedAgo - HOUR), ends_at: iso(now - endedAgo) }, now);
  check(!ended(ACCESS - 1) && ended(ACCESS) && !ended(-HOUR), "5a. the details are shown until exactly 30 days after the end, and before it");
  check(contactAccessEnded({ starts_at: iso(now - ACCESS), ends_at: null }, now), "5b. ...counting from the start when there's no end");

  // 6. A search by date (browse's dayRangeInstants): each date covers exactly
  // its Atlanta day, from midnight to the next midnight, 23 or 25 hours on a
  // clock-change day, worked out here with Intl alone.
  const hoursIn = (date: string) => (date === "2026-11-01" ? 25 : date === "2027-03-14" ? 23 : 24);
  const one = dayRangeInstants(today, today, ATL);
  const from = Date.parse(one.from!);
  const to = Date.parse(one.to!);
  check(atlDay(from) === today && wall(from) === "00:00" && atlDay(from - 1) === addDays(today, -1),
    `6a. a search for ${today} starts at its Atlanta midnight, not before`);
  check(atlDay(to) === addDays(today, 1) && wall(to) === "00:00" && atlDay(to - 1) === today,
    "6b. ...and ends at the next one, the last minute included");
  check(to - from === hoursIn(today) * HOUR, `6c. ...${hoursIn(today)} hours, today's length in Atlanta`);
  const three = dayRangeInstants(today, addDays(today, 2), ATL);
  check(Date.parse(three.to!) - Date.parse(three.from!) === [0, 1, 2].reduce((sum, d) => sum + hoursIn(addDays(today, d)), 0) * HOUR,
    "6d. a three-day search is the three days' hours, clock changes included");
  check(dayRangeInstants(undefined, undefined, ATL).from === undefined && dayRangeInstants(today, undefined, ATL).to === undefined,
    "6e. a side with no date is left out");
}

const instants: [string, string][] = process.env.TEST_INSTANTS === "all" ? ALL() : [["TEST_NOW", process.env.TEST_NOW ?? new Date().toISOString()]];
quiet = instants.length > 1;
for (const [name, instant] of instants) {
  const now = Date.parse(instant);
  if (Number.isNaN(now)) {
    console.error(`Not an instant: ${instant}`);
    process.exit(2);
  }
  where = `${name}; ${instant}`;
  checksAt(now);
}
// Quiet mode prints only failures, so it reports its passes as one line
// (the test runs' guard, scripts/tests/_requireChecks.mjs, counts it).
if (quiet) console.log(failures ? `${failures} failed across ${instants.length} instants` : `ok   ${passed} checks passed at all ${instants.length} instants.`);
else console.log(failures ? `${failures} failed` : "All clock sweep checks passed.");
process.exit(failures ? 1 : 0);
