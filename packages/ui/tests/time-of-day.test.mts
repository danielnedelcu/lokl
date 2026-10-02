// The time field's conversion (packages/ui/app/utils/zonedTime.ts, used by
// TimeInput.vue): 12-hour dropdowns to the form's "HH:MM" and back, and a
// half-chosen time kept apart from "no time" so the form can say what's
// missing instead of "Choose a start time." (the session form bug,
// 2026-10-02).
// Run: npx tsx packages/ui/tests/time-of-day.test.mts
import { fromTimeOfDay, INCOMPLETE_TIME, isTimeOfDay, toTimeOfDay } from "../app/utils/zonedTime";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };

check(toTimeOfDay("6", "30", "PM") === "18:30", "1. 6:30 PM is 18:30 (the reported case)");
check(toTimeOfDay("12", "00", "AM") === "00:00" && toTimeOfDay("12", "00", "PM") === "12:00", "2. 12 AM is midnight and 12 PM is noon");
check(toTimeOfDay("9", "05", "AM") === "09:05" && toTimeOfDay("11", "55", "PM") === "23:55", "3. morning and late-night times");
check(toTimeOfDay("6", "30", "") === INCOMPLETE_TIME, "4. 6:30 without AM or PM is incomplete, not empty");
check(toTimeOfDay("", "", "") === "", "5. nothing chosen is empty");
check(!isTimeOfDay(INCOMPLETE_TIME) && isTimeOfDay("18:30"), "6. an incomplete time isn't a time");
const round = ["00:00", "00:30", "11:59", "12:00", "12:15", "18:30", "23:55"].every((t) => {
  const p = fromTimeOfDay(t)!;
  return toTimeOfDay(p.hour, p.minute, p.half) === t;
});
check(round, "7. every time survives the trip to the dropdowns and back (editing a session)");
check(fromTimeOfDay(INCOMPLETE_TIME) === null && fromTimeOfDay("") === null, "8. nothing to show for an empty or incomplete time");

console.log(failures ? `${failures} failed` : "All time-of-day checks passed.");
process.exit(failures ? 1 : 0);
