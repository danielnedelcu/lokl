// The search bar's quick dates (Today, Tomorrow, This weekend), worked out in
// the market's zone, never the device's (docs/design/search.md). "This
// weekend" is Saturday and Sunday: Monday to Friday, the coming Saturday and
// Sunday; on Saturday, today and Sunday; on Sunday, today only. Run in two
// device zones, Tokyo and Los Angeles, by `npm run test:ui`.
// Run: TZ=Asia/Tokyo npx tsx packages/ui/tests/quick-dates.test.mts
import { quickDates } from "../app/utils/zonedTime";

const ATL = "America/New_York";
let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const at = (iso: string) => quickDates(ATL, iso);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const device = Intl.DateTimeFormat().resolvedOptions().timeZone;

// 1. A Wednesday afternoon: tomorrow is Thursday, the weekend is Sat-Sun.
const wed = at("2026-10-14T18:00:00Z"); // 2:00 PM Wed Oct 14 in Atlanta
check(wed.today === "2026-10-14" && wed.tomorrow === "2026-10-15", "1a. Wednesday: today Oct 14, tomorrow Oct 15");
check(same(wed.weekend, { from: "2026-10-17", to: "2026-10-18" }), "1b. Wednesday: this weekend is Sat Oct 17 - Sun Oct 18");

// 2. 11:30 PM Friday in Atlanta is already Saturday in UTC (and in Tokyo).
const lateFri = at("2026-10-17T03:30:00Z");
check(lateFri.today === "2026-10-16" && lateFri.tomorrow === "2026-10-17", "2a. 11:30 PM Friday in Atlanta: today is still Friday Oct 16");
check(same(lateFri.weekend, { from: "2026-10-17", to: "2026-10-18" }), "2b. ...and this weekend is the coming Sat Oct 17 - Sun Oct 18");

// 3. Just after midnight on Saturday: the weekend starts today.
const sat = at("2026-10-17T04:15:00Z"); // 12:15 AM Sat Oct 17 in Atlanta
check(sat.today === "2026-10-17" && same(sat.weekend, { from: "2026-10-17", to: "2026-10-18" }), "3. 12:15 AM Saturday: this weekend is today and Sunday");

// 4. Sunday: today only. Late Sunday is already Monday in UTC.
const sun = at("2026-10-19T03:30:00Z"); // 11:30 PM Sun Oct 18 in Atlanta
check(sun.today === "2026-10-18" && same(sun.weekend, { from: "2026-10-18", to: "2026-10-18" }), "4a. 11:30 PM Sunday: this weekend is today only");
check(sun.tomorrow === "2026-10-19", "4b. ...and tomorrow is Monday Oct 19");

// 5. The clock-change weekend (Nov 1, 2026 is the change): still Sat Oct 31 - Sun Nov 1.
const thu = at("2026-10-30T02:00:00Z"); // 10:00 PM Thu Oct 29
check(same(thu.weekend, { from: "2026-10-31", to: "2026-11-01" }), "5a. across the November clock change: Sat Oct 31 - Sun Nov 1");
const changeDay = at("2026-11-01T06:30:00Z"); // 1:30 AM EST, the second 1:30 on Nov 1
check(changeDay.today === "2026-11-01" && same(changeDay.weekend, { from: "2026-11-01", to: "2026-11-01" }), "5b. on the change day itself (Sunday): today only");

// 6. A month and a year boundary.
const dec = at("2026-12-31T22:00:00Z"); // 5:00 PM Thu Dec 31
check(dec.tomorrow === "2027-01-01" && same(dec.weekend, { from: "2027-01-02", to: "2027-01-03" }), "6. Dec 31: tomorrow is Jan 1, this weekend Jan 2-3");

// 7. Labels: the dates under each, in Atlanta.
check(wed.labels.today === "Wed, Oct 14" && wed.labels.tomorrow === "Thu, Oct 15", "7a. Today and Tomorrow show their dates");
check(wed.labels.weekend === "Sat, Oct 17 – Sun, Oct 18", "7b. This weekend shows both dates");
check(sun.labels.weekend === "Sun, Oct 18", "7c. On Sunday, one date");

console.log(failures ? `${failures} failed (device zone ${device})` : `All quick date checks passed (device zone ${device}).`);
process.exit(failures ? 1 : 0);
