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
