// Session times: entered and shown in the listing city's time zone
// (docs/frontend.md), whatever time zone the provider's device is in.
// Built on @internationalized/date (also used by Reka UI), which handles
// daylight saving: a weekly 10:00 AM series stays at 10:00 AM local time when
// the clocks change, even though its UTC time moves by an hour.
import { parseDate, parseDateTime, toZoned, now } from "@internationalized/date";

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

/** Today's date in `timeZone`, for the date input's minimum. */
export function todayIn(timeZone: string): string {
  return now(timeZone).toString().slice(0, 10);
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
