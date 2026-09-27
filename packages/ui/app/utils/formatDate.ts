// The one place dates are formatted for display (docs/frontend.md).
// Pass the listing's or city's IANA time zone when there is one; without it,
// the viewer's own time zone is used. Never use toISOString() for a calendar
// day: it converts to UTC and can land on the wrong date.
export function formatDate(value: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(value));
}
