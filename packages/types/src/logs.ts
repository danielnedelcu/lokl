// Text stored in lokl's logs (job_runs, and the email outboxes' last_error).
// Those rows are append-only (migration append_only_logs), so they name rows
// by id and never hold a person's contact details: error messages from
// Resend, Stripe or Postgres pass through logText() before they're stored,
// and any email address or phone number they quote is replaced. Then a log
// never needs anonymising. (Server logs from console.error aren't covered.)

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// A phone number written the usual ways: 404-555-0182, (404) 555 0182,
// +1 404.555.0182, +44 20 7946 0958. Not part of an id, a date or a longer
// number (no letter, digit or dash touching either end).
const PHONE = /(?<![\w-])(\+\d{1,3}[ .-]?)?(\(\d{2,4}\)|\d{2,4})[ .-]\d{3,4}[ .-]?\d{4}(?![\w-])/g;

/** Log-safe text: email addresses and phone numbers replaced, cut to `max` characters. */
export function logText(text: string, max: number): string {
  return text.replace(EMAIL, "[email address]").replace(PHONE, "[phone number]").slice(0, max);
}
