// The Availability page's forms (docs/design/service-availability.md, phase
// 2): intervals must be whole times, end after they start (12:00 AM as an end
// is midnight), and not overlap on one day (touching is fine); an open day
// needs hours; the weekly form becomes the rows the database saves.
// Run: npx tsx packages/ui/tests/availability-forms.test.mts (part of `npm run test:ui`).
import { dateHoursSchema, durationWords, formatClock, scheduleSchema, timeOffSchema, weeklyHoursRows, weeklyHoursSchema } from "../../types/src/availability";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const closed = { open: false, intervals: [] };
const week = (monday: { open: boolean; intervals: { starts: string; ends: string }[] }) => ({ days: [closed, monday, closed, closed, closed, closed, closed] });
const errors = (v: object) => {
  const r = weeklyHoursSchema.safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

check(formatClock("09:00") === "9:00 AM" && formatClock("13:30") === "1:30 PM" && formatClock("00:00") === "12:00 AM" && formatClock("12:00") === "12:00 PM", "1a. clock times in words");
check(formatClock("24:00") === "midnight" && formatClock("00:00", { end: true }) === "midnight", "1b. 24:00, or an end of 12:00 AM, is midnight");

check(Object.keys(errors(week({ open: true, intervals: [{ starts: "09:00", ends: "12:00" }, { starts: "12:00", ends: "17:00" }] }))).length === 0, "2a. two intervals that touch are fine");
check(errors(week({ open: true, intervals: [{ starts: "09:00", ends: "12:00" }, { starts: "11:00", ends: "14:00" }] }))["days.1.intervals.1.starts"] === "Overlaps 9:00 AM – 12:00 PM.",
  "2b. an overlap says which hours it overlaps, on the later interval");
check(errors(week({ open: true, intervals: [{ starts: "17:00", ends: "09:00" }] }))["days.1.intervals.0.ends"] === "Ends before it starts.", "2c. an end before the start");
check(Object.keys(errors(week({ open: true, intervals: [{ starts: "18:00", ends: "00:00" }] }))).length === 0, "2d. 6:00 PM to 12:00 AM (midnight) is fine");
check(errors(week({ open: true, intervals: [{ starts: "incomplete", ends: "10:00" }] }))["days.1.intervals.0.starts"] === "Choose the hour, minutes and AM or PM.", "2e. a half-chosen time says what's missing");
check(errors(week({ open: true, intervals: [] }))["days.1.open"] === "Add hours for Monday, or untick it.", "2f. an open day needs hours");
check(Object.keys(errors(week({ open: false, intervals: [{ starts: "17:00", ends: "09:00" }] }))).length === 0, "2g. a closed day's leftover hours aren't checked");

check(JSON.stringify(weeklyHoursRows(week({ open: true, intervals: [{ starts: "18:00", ends: "00:00" }] }))) === JSON.stringify([{ weekday: 1, starts: "18:00", ends: "24:00" }]),
  "3a. the rows to save: Monday 18:00 to 24:00 (midnight)");
check(weeklyHoursRows(week({ open: false, intervals: [{ starts: "09:00", ends: "17:00" }] })).length === 0, "3b. a closed day saves no rows");

const d = dateHoursSchema.safeParse({ date: "", intervals: [] });
check(!d.success && d.error.issues.some((i) => i.message === "Choose a date."), "4a. hours for a date need a date");
const d2 = dateHoursSchema.safeParse({ date: "2026-10-20", intervals: [] });
check(!d2.success && d2.error.issues.some((i) => i.message === "Add hours for this date."), "4b. ...and hours");

check(durationWords(60) === "1 hour" && durationWords(90) === "1 hour 30 minutes" && durationWords(1440) === "24 hours" && durationWords(2880) === "2 days" && durationWords(10080) === "1 week" && durationWords(0) === "none",
  "5. lengths of time in words");

// 6. Never zod's own words: every rule says what to do, wrong types included
//    (an unticked day's checkbox once sent undefined: "Invalid input:
//    expected boolean, received undefined").
const raw = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, v: unknown) =>
  (schema.safeParse(v).error?.issues ?? []).map((i) => i.message).filter((m) => /^Invalid input|^Expected|received/i.test(m));
const junk = [undefined, null, 5, "x", {}, [], { days: [{}] }, { days: Array(7).fill({ open: undefined, intervals: [{ starts: 1, ends: null }] }) },
  { date: 3, intervals: "no" }, { range: null, note: 7 }, { booking_window_days: undefined, min_notice_minutes: "soon" }];
const leaks = junk.flatMap((v) => [...raw(weeklyHoursSchema, v), ...raw(dateHoursSchema, v), ...raw(timeOffSchema, v), ...raw(scheduleSchema, v)]);
check(leaks.length === 0, `6a. no raw messages, whatever the values (${leaks.slice(0, 2).join(" / ") || "none"})`);
const unticked = weeklyHoursSchema.safeParse({ days: Array(7).fill({ open: undefined, intervals: [] }) });
check(!unticked.success && unticked.error.issues.every((i) => i.message === "Tick the day if you're open, or untick it if you're not."),
  "6b. a day with no open value says so plainly (the checkbox now always sends true or false)");

const leftover = weeklyHoursSchema.safeParse(week({ open: false, intervals: [{ starts: undefined, ends: undefined }] as never }));
check(leftover.success, "6c. a closed day whose hours fields were just removed (values gone) is simply closed: no hidden error to block saving");

console.log(failures ? `${failures} failed` : "All availability form checks passed.");
process.exit(failures ? 1 : 0);
