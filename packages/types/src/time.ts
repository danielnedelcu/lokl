// Which clock a time is shown on (docs/frontend.md; the time-zone guard,
// 2026-10-10). Anything tied to a booking, listing or session is shown in
// its market's zone; the admin's own operational times (when something was
// edited, logged or changed) in the home zone, labelled "Atlanta time".

/** lokl's home zone: Atlanta, the first market. */
export const HOME_TIME_ZONE = "America/New_York";
/** The words for the home zone's clock. */
export const HOME_TIME_LABEL = "Atlanta time";

/**
 * A market's zone, from its city row. cities.timezone is required and
 * checked against real zone names, so a missing zone means the city itself
 * is missing (not read, or hidden by the read rules): logged, and the home
 * zone used, so a page still shows a time rather than failing.
 */
export function marketZone(city: { timezone?: string | null } | null | undefined, what = "a record"): string {
  if (city?.timezone) return city.timezone;
  console.warn(`[time zone] No market time zone for ${what}; using ${HOME_TIME_LABEL}.`);
  return HOME_TIME_ZONE;
}

/**
 * " EDT" or " EST" when an instant's wall-clock time happens twice in
 * `timeZone` (the repeated hour when clocks go back in November), so the
 * two 1:30 AMs read differently; "" for every other time (2026-10-18). lokl
 * offers the first one (daylight time; wall_clock_instant in the database),
 * but a time shown can still be the second, such as a session's end.
 */
export function repeatedHourZone(instant: string | Date, timeZone: string): string {
  const t = new Date(instant).getTime();
  const wall = (ms: number) => new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(ms));
  const here = wall(t);
  if (wall(t - 3_600_000) !== here && wall(t + 3_600_000) !== here) return "";
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(t)).find((p) => p.type === "timeZoneName")?.value;
  return name ? ` ${name}` : "";
}
