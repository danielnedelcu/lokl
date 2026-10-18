// What reaches lokl's append-only logs (packages/types/src/logs.ts): error
// messages keep their ids, dates and amounts, but not an email address or a
// phone number they quote.
// Run: npx tsx packages/ui/tests/log-text.test.mts (part of `npm run test:ui`).
import { errorText, logText } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const replaced: [string, string][] = [
  ["Resend 403: You can only send testing emails to your own email address (sam.lee+test@example.co.uk).",
    "Resend 403: You can only send testing emails to your own email address ([email address])."],
  ["Resend 422: Invalid `to` field: Sam@Example.com", "Resend 422: Invalid `to` field: [email address]"],
  ["call 404-555-0182 or (404) 555 0182", "call [phone number] or [phone number]"],
  ["+1 404.555.0182 and +44 20 7946 0958", "[phone number] and [phone number]"],
];
const kept = [
  "3f2b9c1e-1234-5678-9012-345678901234 customer_booking_confirmed: Resend 500: Internal server error",
  "6c1d8a52-0000-4000-8000-000000000001: No such charge: 'ch_3PxYz12345678901'",
  "Waited 48 hours for Resend's limits. Resend 429: Too many requests",
  "payout due 2026-10-12 14:30, amount 4500, transfer tr_1234567890",
  "new row for relation \"bookings\" violates check constraint \"bookings_status_check\"",
];
for (const [text, want] of replaced) check(logText(text, 500) === want, `"${text}" becomes "${want}"`);
for (const text of kept) check(logText(text, 500) === text, `"${text}" is kept as it is`);
check(logText("x".repeat(600), 500).length === 500, "it's cut to the column's length");
check(logText("ab@example.com", 6) === "[email", "the address is replaced before cutting, so a cut can't leave part of it");

// errorText: a server log's line for any error, never the object itself.
const pg = { code: "23505", message: "duplicate key value violates unique constraint \"booking_contacts_pkey\"",
  details: "Key (email)=(sam.lee@example.com) already exists.", hint: null, row: { phone: "404-555-0182" } };
const pgLine = errorText(pg);
check(pgLine === "23505: duplicate key value violates unique constraint \"booking_contacts_pkey\" | Key (email)=([email address]) already exists.",
  "errorText: a database error's code, message and details, with the email replaced");
check(!pgLine.includes("404-555-0182"), "errorText: nothing outside code, message, details and hint (the row's values) is printed");
const resend = Object.assign(new Error("Resend 422: Invalid `to` field: Sam@Example.com"), { status: 422 });
check(errorText(resend) === "422: Resend 422: Invalid `to` field: [email address]", "errorText: an Error's status and message, with the email replaced");
check(errorText("call 404-555-0182") === "call [phone number]", "errorText: plain text goes through logText");
check(errorText(null) === "Unknown error" && errorText({}) === "Unknown error", "errorText: nothing to say is still one line");

console.log(failures ? `${failures} failed` : "All log text checks passed.");
process.exit(failures ? 1 : 0);
