// The instants the clock sweep checks (2026-10-19), shared by test:clock
// (every push) and the nightly app-test sweep (scripts/test-clock-apps.mjs).
// supabase/tests/slot_instants.test.sql makes the same hourly set in SQL.
//
// - NAMED: the edges that have broken a test or could (a month's and a
//   year's last minute, the repeated and skipped hours, a weekend).
// - everyHour(): every real hour of four Atlanta days, twice (5 past, 5 to):
//   a Wednesday, a Saturday, and both clock-change days (25 and 23 hours),
//   192 instants, in Atlanta's order of time.

export const NAMED = [
  ["Friday 3:30 PM (a day's notice leaves one or two times)", "2026-10-23T19:30:00Z"],
  ["Saturday 11:30 PM (the week's last day, nearly over)", "2026-10-25T03:30:00Z"],
  ["Sunday 8:30 AM (a new week; notice crossing the first times)", "2026-10-25T12:30:00Z"],
  ["11:59 PM on the last day of a month", "2026-11-01T03:59:00Z"],
  ["November's repeated hour, the first 1:30 AM (EDT)", "2026-11-01T05:30:00Z"],
  ["November's repeated hour, the second 1:30 AM (EST)", "2026-11-01T06:30:00Z"],
  ["11:59 PM on New Year's Eve", "2027-01-01T04:59:00Z"],
  ["March's skipped hour (2:30 AM doesn't exist; 3:30 AM EDT)", "2027-03-14T07:30:00Z"],
];

/** Atlanta midnight at the start of each day, as an instant (UTC). */
const DAYS = [
  ["a Wednesday", "2026-10-21T04:00:00Z", "2026-10-22T04:00:00Z"],
  ["a Saturday", "2026-10-24T04:00:00Z", "2026-10-25T04:00:00Z"],
  ["November's change day (25 hours)", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
  ["March's change day (23 hours)", "2027-03-14T05:00:00Z", "2027-03-15T04:00:00Z"],
];

const wall = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(t));

/** Every real hour of the four days, at 5 past and 5 to: [label, ISO instant]. */
export function everyHour() {
  const out = [];
  for (const [day, from, to] of DAYS) {
    for (let h = Date.parse(from); h < Date.parse(to); h += 3_600_000) {
      for (const t of [h + 5 * 60_000, h + 55 * 60_000]) out.push([`${day}, ${wall(t)}`, new Date(t).toISOString()]);
    }
  }
  return out;
}

/** Every instant test:clock checks: the named edges, then every hour. */
export const ALL = () => [...NAMED, ...everyHour()];
