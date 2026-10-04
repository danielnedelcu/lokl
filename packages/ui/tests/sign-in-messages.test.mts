// The sign-in form's messages (packages/ui/app/utils/signInMessages.ts):
// wrong and expired codes told apart by time, tries left, the lock after
// five, Supabase's limits, and an admin's unknown address not revealed.
// Run: npx tsx packages/ui/tests/sign-in-messages.test.mts (part of `npm run test:ui`).
import {
  checkCodeBeforeSending, cleanCode, codeRefusedMessage, CODE_LIFE_MS, resendLabel, sendFailedMessage,
} from "../app/utils/signInMessages";

let failures = 0;
const check = (ok: boolean, name: string, got?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
};

const now = 1_000_000_000;
const fresh = now - 60_000;
const old = now - CODE_LIFE_MS;
const wrong = { code: "otp_expired", status: 403, message: "Token has expired or is invalid" };

check(cleanCode(" 123 456 ") === "123456" && cleanCode("123-456") === "123456" && cleanCode("1234567") === "123456", "1. spaces and dashes are ignored; at most 6 digits");
check(checkCodeBeforeSending("12345", fresh, now) === "Enter the 6-digit code from the email.", "2. a short code isn't sent");
check(checkCodeBeforeSending("123456", fresh, now) === null, "3. a full code, in time, is sent");
check(checkCodeBeforeSending("123456", old, now) === "This code has expired. Send a new code.", "4. past 10 minutes, it isn't sent: expired");

let r = codeRefusedMessage(wrong, 1, fresh, now);
check(r.message === "That code isn't right. Check the email and try again." && !r.locked, "5. a wrong code, in time: not right (no count yet)", r);
r = codeRefusedMessage(wrong, 3, fresh, now);
check(r.message.endsWith("2 tries left.") && !r.locked, "6. from the third: the tries left", r);
r = codeRefusedMessage(wrong, 4, fresh, now);
check(r.message.endsWith("1 try left."), "7. ...singular at one", r);
r = codeRefusedMessage(wrong, 5, fresh, now);
check(r.message === "That's 5 wrong codes. Send a new code to try again." && r.locked, "8. the fifth wrong code locks the field", r);
r = codeRefusedMessage(wrong, 1, old, now);
check(r.message === "This code has expired. Send a new code." && r.locked, "9. the same error after 10 minutes: expired", r);
r = codeRefusedMessage({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }, 2, fresh, now);
check(r.message.startsWith("Too many tries from this device") && !r.locked, "10. Supabase's verify limit", r);
r = codeRefusedMessage({ message: "Failed to fetch" }, 1, fresh, now);
check(r.message.startsWith("We couldn't check the code") && !r.locked, "11. offline: not counted as wrong", r);

const tooSoon = { status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 42 seconds." };
check(sendFailedMessage(tooSoon) === "You can ask for a new code in 42 seconds.", "12. sending too soon: the seconds from Supabase");
check(sendFailedMessage({ ...tooSoon, message: "For security purposes, you can only request this after 0 seconds." }) === "You can ask for a new code in 1 second.",
  "12b. Supabase's \"0 seconds\" reads as 1 second");
check(sendFailedMessage({ status: 429, message: "Email rate limit exceeded" }).startsWith("Too many sign-in emails"), "13. the hourly email limit");
const unknown = { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" };
const adminMsg = sendFailedMessage(unknown, { admin: true });
check(adminMsg === sendFailedMessage({ message: "Failed to fetch" }, { admin: true }) && adminMsg.includes("admin's email address"),
  "14. admin: an unknown address reads the same as any other failure");
check(resendLabel(now - 18_000, now) === "Send a new code in 42 s" && resendLabel(now - 60_000, now) === "Send a new code", "15. the resend countdown");

if (failures) {
  console.error(`${failures} sign-in message check(s) failed.`);
  process.exit(1);
}
console.log("All sign-in message checks passed.");
