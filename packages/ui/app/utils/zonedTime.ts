// Session times: entered and shown in the listing city's time zone
// (docs/frontend.md), whatever time zone the provider's device is in.
// Built on @internationalized/date (also used by Reka UI), which handles
// daylight saving: a weekly 10:00 AM series stays at 10:00 AM local time when
// the clocks change, even though its UTC time moves by an hour.
import { getDayOfWeek, parseDate, parseDateTime, toZoned, now } from "@internationalized/date";

/** A wall-clock date and time in a city: "2026-10-24" and "10:00". */
export interface LocalDateTime {
  date: string;
  time: string;
}

/**
 * The instant (ISO string with offset, for timestamptz) of a local date and
 * time in `timeZone`. A time skipped when clocks go forward moves one hour
 * later, like a phone's clock.
 */
export function zonedToInstant({ date, time }: LocalDateTime, timeZone: string): string {
  return toZoned(parseDateTime(`${date}T${time}`), timeZone).toAbsoluteString();
}

/**
 * `count` weekly instants starting at a local date and time, each at the same
 * local time in `timeZone`.
 */
export function weeklyInstants(start: LocalDateTime, count: number, timeZone: string): string[] {
  const first = parseDateTime(`${start.date}T${start.time}`);
  return Array.from({ length: count }, (_, week) =>
    toZoned(first.add({ weeks: week }), timeZone).toAbsoluteString(),
  );
}

/** The local date ("2026-10-24") and time ("10:00") of an instant in `timeZone`. */
export function instantToZoned(instant: string, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Today's date in `timeZone`, for the date input's minimum. `at` (an instant) is for tests. */
export function todayIn(timeZone: string, at?: string): string {
  return at ? instantToZoned(at, timeZone).date : now(timeZone).toString().slice(0, 10);
}

/** The instant this month began in `timeZone` (midnight on the 1st there). `at` is for tests. */
export function monthStartIn(timeZone: string, at?: string): string {
  return zonedToInstant({ date: `${todayIn(timeZone, at).slice(0, 7)}-01`, time: "00:00" }, timeZone);
}

/** A calendar date ("2026-10-14") as "Wed, Oct 14": the day itself, in no zone. */
export function formatCalendarDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(date).toDate("UTC"));
}

/**
 * The search bar's quick dates in `timeZone` (docs/design/search.md), with
 * the dates shown under each. "This weekend" is Saturday and Sunday: Monday
 * to Friday, the coming Saturday and Sunday; on Saturday, today and Sunday;
 * on Sunday, today only. `at` is for tests.
 */
export function quickDates(timeZone: string, at?: string) {
  const today = todayIn(timeZone, at);
  const day = getDayOfWeek(parseDate(today), "en-US"); // 0 is Sunday
  const weekend = day === 0 ? { from: today, to: today } : { from: addDays(today, 6 - day), to: addDays(today, 7 - day) };
  const tomorrow = addDays(today, 1);
  return {
    today,
    tomorrow,
    weekend,
    labels: {
      today: formatCalendarDay(today),
      tomorrow: formatCalendarDay(tomorrow),
      weekend: weekend.from === weekend.to ? formatCalendarDay(weekend.from) : `${formatCalendarDay(weekend.from)} – ${formatCalendarDay(weekend.to)}`,
    },
  };
}

/** A calendar date as "Friday, October 16": the day itself, in no zone. */
export function formatCalendarDayLong(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(parseDate(date).toDate("UTC"));
}

/** A calendar date with its year, "October 17, 2026" (a page's "Last updated"). */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parseDate(date).toDate("UTC"));
}

/** The Sunday on or before a calendar date: the start of its week in a date strip. */
export function weekStartOf(date: string): string {
  return parseDate(date).subtract({ days: getDayOfWeek(parseDate(date), "en-US") }).toString();
}

/** A local date plus `days`, for the date input's maximum. */
export function addDays(date: string, days: number): string {
  return parseDate(date).add({ days }).toString();
}

/** "Sat, Oct 24" in `timeZone`. */
export function formatSessionDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })
    .format(new Date(instant));
}

/** "10:00 AM" in `timeZone`. */
export function formatSessionTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone })
    .format(new Date(instant));
}

/** "Atlanta time (ET)": which clock the times are in. */
export function timeZoneLabel(cityName: string, timeZone: string): string {
  const abbr = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortGeneric" })
    .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
  return abbr ? `${cityName} time (${abbr})` : `${cityName} time`;
}

/** What a TimeInput holds while only some of hour, minutes and AM/PM are chosen. */
export const INCOMPLETE_TIME = "incomplete";

/** True for a complete "HH:MM" time, as TimeInput gives it. */
export const isTimeOfDay = (v: string) => /^\d{2}:\d{2}$/.test(v);

/** "6", "30", "PM" → "18:30"; INCOMPLETE_TIME if only some are chosen; "" if none. */
export function toTimeOfDay(hour: string, minute: string, half: "" | "AM" | "PM"): string {
  if (hour && minute && half) {
    const h24 = (Number(hour) % 12) + (half === "PM" ? 12 : 0);
    return `${String(h24).padStart(2, "0")}:${minute}`;
  }
  return hour || minute || half ? INCOMPLETE_TIME : "";
}

/** "18:30" → { hour: "6", minute: "30", half: "PM" }; null if not a complete time. */
export function fromTimeOfDay(v: string): { hour: string; minute: string; half: "AM" | "PM" } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h24 = Number(m[1]);
  return { hour: String(h24 % 12 || 12), minute: m[2]!, half: h24 < 12 ? "AM" : "PM" };
}
