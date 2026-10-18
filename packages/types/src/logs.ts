import { redactSecrets } from "./secrets";
// Text stored in lokl's logs (job_runs, and the email outboxes' last_error).
// Those rows are append-only (migration append_only_logs), so they name rows
// by id and never hold a person's contact details: error messages from
// Resend, Stripe or Postgres pass through logText() before they're stored,
// and any email address or phone number they quote is replaced. Then a log
// never needs anonymising. Anything key-shaped is redacted too
// (redactSecrets in secrets.ts).

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// A phone number written the usual ways: 404-555-0182, (404) 555 0182,
// +1 404.555.0182, +44 20 7946 0958. Not part of an id, a date or a longer
// number (no letter, digit or dash touching either end).
const PHONE = /(?<![\w-])(\+\d{1,3}[ .-]?)?(\(\d{2,4}\)|\d{2,4})[ .-]\d{3,4}[ .-]?\d{4}(?![\w-])/g;

/** Log-safe text: keys, email addresses and phone numbers replaced, cut to `max` characters. */
export function logText(text: string, max: number): string {
  return redactSecrets(text).replace(EMAIL, "[email address]").replace(PHONE, "[phone number]").slice(0, max);
}

/**
 * One line for a log about a failed Stripe call (or any error): its type,
 * status, code and request id, then its message through logText (no keys,
 * email addresses or phone numbers). Stripe can quote what was sent back.
 */
export function stripeErrorSummary(e: unknown): string {
  const err = (e ?? {}) as { type?: string; name?: string; statusCode?: number; code?: string; requestId?: string; message?: string };
  const what = [err.type ?? err.name ?? "Error", err.statusCode, err.code, err.requestId].filter(Boolean).join(" ");
  return logText(`${what}: ${err.message ?? String(e)}`, 1000);
}

/**
 * One line for a server log about any failure (a database, Resend or other
 * error): its name, status and code, then its message, details and hint,
 * through logText. Never the error object itself, which can carry the
 * row's values or the request that failed (decided 2026-10-17: server logs
 * hold no contact details).
 */
export function errorText(e: unknown): string {
  if (typeof e === "string") return logText(e, 1000);
  if (e === null || e === undefined) return "Unknown error";
  const err = e as { name?: string; status?: number; statusCode?: number; code?: string; message?: string; details?: string | null; hint?: string | null };
  const what = [err.name && err.name !== "Error" ? err.name : null, err.status ?? err.statusCode, err.code].filter(Boolean).join(" ");
  const words = [err.message ?? (e instanceof Object ? "" : String(e)), err.details, err.hint].filter(Boolean).join(" | ");
  return logText([what, words].filter(Boolean).join(": ") || "Unknown error", 1000);
}
