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
