import { z } from "zod";

// A provider's availability (docs/design/service-availability.md, phase 2):
// the forms on the Availability page. Times are wall-clock "HH:MM" in the
// market's zone (TimeInput); an end of 12:00 AM means midnight, the end of
// the day, stored as 24:00. The database refuses the same mistakes
// (overlaps, an end before the start) and saves each section in one step.

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** TimeInput's value when only some of hour, minutes and AM/PM are chosen. */
const INCOMPLETE = "incomplete";
const TIME = /^\d{2}:\d{2}$/;

/** An end time as stored: 12:00 AM (00:00) is midnight, the end of the day. */
export const endOfInterval = (ends: string) => (ends === "00:00" ? "24:00" : ends);

/** "13:00" as "1:00 PM"; "24:00" (or an end of "00:00") as "midnight". */
export function formatClock(v: string, { end = false } = {}): string {
  if (v === "24:00" || (end && v === "00:00")) return "midnight";
  const [h, m] = v.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Every rule here says what to do in plain words, the wrong-type case
// included: none of zod's own messages ("Invalid input: …") reach the page.
const interval = z.object({ starts: z.string("Choose a start time."), ends: z.string("Choose an end time.") }, "Add the hours again.");
export type HoursInterval = z.infer<typeof interval>;

/** Checks one day's intervals, adding issues at `path` (…intervals.i.starts/ends). */
function checkIntervals(intervals: HoursInterval[], ctx: z.RefinementCtx, path: (string | number)[]) {
  const complete: { i: number; starts: string; ends: string }[] = [];
  intervals.forEach((raw, i) => {
    // Whatever the fields hold (a field just removed holds nothing).
    const iv = { starts: typeof raw?.starts === "string" ? raw.starts : "", ends: typeof raw?.ends === "string" ? raw.ends : "" };
    for (const key of ["starts", "ends"] as const) {
      const v = iv[key];
      if (v === INCOMPLETE) ctx.addIssue({ code: "custom", path: [...path, i, key], message: "Choose the hour, minutes and AM or PM." });
      else if (!TIME.test(v)) ctx.addIssue({ code: "custom", path: [...path, i, key], message: key === "starts" ? "Choose a start time." : "Choose an end time." });
    }
    if (TIME.test(iv.starts) && TIME.test(iv.ends)) {
      const ends = endOfInterval(iv.ends);
      if (ends <= iv.starts) ctx.addIssue({ code: "custom", path: [...path, i, "ends"], message: "Ends before it starts." });
      else complete.push({ i, starts: iv.starts, ends });
    }
  });
  // Overlaps (touching is fine): each interval against the ones before it.
  for (const a of complete) {
    const clash = complete.find((b) => b.i < a.i && a.starts < b.ends && b.starts < a.ends);
    if (clash) {
      ctx.addIssue({ code: "custom", path: [...path, a.i, "starts"], message: `Overlaps ${formatClock(clash.starts)} – ${formatClock(clash.ends, { end: true })}.` });
    }
  }
}

export const weeklyHoursSchema = z
  .object({
    days: z.array(z.object({
      open: z.boolean("Tick the day if you're open, or untick it if you're not."),
      // Checked below, and only while the day is open: a closed day's hours
      // (if any are left) never stop a save.
      intervals: z.array(z.unknown()).catch([]),
    }, "Choose your hours again."), "Choose your hours again.").length(7, "Choose your hours again."),
  }, "Choose your hours again.")
  .superRefine((v, ctx) => {
    v.days.forEach((d, day) => {
      if (!d.open) return;
      if (!d.intervals.length) ctx.addIssue({ code: "custom", path: ["days", day, "open"], message: `Add hours for ${WEEKDAYS[day]}, or untick it.` });
      checkIntervals(d.intervals as HoursInterval[], ctx, ["days", day, "intervals"]);
    });
  });
export type WeeklyHoursInput = { days: { open: boolean; intervals: HoursInterval[] }[] };

/** The weekly form as the rows replace_weekly_hours saves (closed days have none). */
export function weeklyHoursRows(v: WeeklyHoursInput) {
  return v.days.flatMap((d, weekday) => (d.open ? d.intervals.map((iv) => ({ weekday, starts: iv.starts, ends: endOfInterval(iv.ends) })) : []));
}

export const dateHoursSchema = z
  .object({ date: z.string("Choose a date.").regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."), intervals: z.array(interval, "Add hours for this date.") }, "Choose a date and its hours.")
  .superRefine((v, ctx) => {
    if (!v.intervals.length) ctx.addIssue({ code: "custom", path: ["date"], message: "Add hours for this date." });
    checkIntervals(v.intervals, ctx, ["intervals"]);
  });
export type DateHoursInput = z.infer<typeof dateHoursSchema>;

export const timeOffSchema = z
  .object({
    range: z.object({ start: z.string("Choose the first day off."), end: z.string("Choose the last day off.") }, "Choose the first and last day off."),
    note: z.string("Write the note as text.").trim().max(200, "Keep the note under 200 characters.").optional(),
  }, "Choose the days off.")
  .superRefine((v, ctx) => {
    if (!v.range.start || !v.range.end) ctx.addIssue({ code: "custom", path: ["range"], message: "Choose the first and last day off." });
  });
export type TimeOffInput = z.infer<typeof timeOffSchema>;

/** The booking settings' choices (each is a dropdown); values are minutes or days. */
export const SCHEDULE_CHOICES = {
  booking_window_days: [7, 14, 30, 60, 90, 180],
  min_notice_minutes: [60, 120, 240, 720, 1440, 2880, 4320, 10080],
  slot_interval_minutes: [15, 30, 60],
  default_buffer_minutes: [0, 15, 30, 45, 60, 90, 120],
} as const;
export const SCHEDULE_DEFAULTS = { booking_window_days: 60, min_notice_minutes: 1440, slot_interval_minutes: 30, default_buffer_minutes: 0 } as const;

const oneOf = (allowed: readonly number[], message: string) =>
  z.preprocess((v) => Number(v), z.number(message).refine((n) => allowed.includes(n), message));
export const scheduleSchema = z.object({
  booking_window_days: oneOf(SCHEDULE_CHOICES.booking_window_days, "Choose how far ahead customers can book."),
  min_notice_minutes: oneOf(SCHEDULE_CHOICES.min_notice_minutes, "Choose the least notice you need."),
  slot_interval_minutes: oneOf(SCHEDULE_CHOICES.slot_interval_minutes, "Choose how often a booking can start."),
  default_buffer_minutes: oneOf(SCHEDULE_CHOICES.default_buffer_minutes, "Choose the time between bookings."),
}, "Choose your booking settings again.");
export type ScheduleInput = z.input<typeof scheduleSchema>;
export type ScheduleOutput = z.output<typeof scheduleSchema>;

/** A length of time in words: 90 → "1 hour 30 minutes", 1440 → "24 hours", 10080 → "1 week". */
export function durationWords(minutes: number): string {
  if (minutes === 0) return "none";
  if (minutes === 10080) return "1 week";
  if (minutes >= 2880 && minutes % 1440 === 0) return `${minutes / 1440} days`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = m ? `${m} minutes` : "";
  return [hours, mins].filter(Boolean).join(" ");
}
