// The one place dates are formatted for display (docs/frontend.md).
// Pass the listing's or city's IANA time zone when there is one; without it,
// the viewer's own time zone is used. Never use toISOString() for a calendar
// day: it converts to UTC and can land on the wrong date.
export function formatDate(value: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(value));
}

// How long ago something happened, in plain words: "less than an hour",
// "5 hours", "3 days". For "waiting 3 days" in the review queue.
export function formatAge(value: string | Date, now: Date = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// A length of time in plain words: "45 minutes", "2 hours", "2 hours 30 minutes".
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  const mins = m ? `${m} ${m === 1 ? "minute" : "minutes"}` : "";
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

// A date and time of day: "Oct 3, 2026, 4:03 PM". Same time zone rule as formatDate.
export function formatDateTime(value: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

// A range of calendar days ("YYYY-MM-DD"), shortest clear form: "Oct 3 – 10,
// 2026", "Oct 28 – Nov 2, 2026". The days are calendar dates, not instants,
// so they're read and shown in UTC and never shift across a time zone.
export function formatDateRange(start: string, end: string): string {
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).formatRange(at(start), at(end));
}
