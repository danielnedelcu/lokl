// What the sign-in form says (docs/design/sign-in-with-code.md, Messages),
// shared by both apps and tested on its own (packages/ui/tests/sign-in-messages.test.mts).
//
// Supabase answers a wrong code and an expired one with the same error
// (otp_expired), so the form tells them apart by when the code was sent;
// past its life it doesn't ask Supabase at all.

export const CODE_LENGTH = 6;
/** How long a code (and the emailed link) works: Email OTP expiration, 600 seconds. */
export const CODE_LIFE_MS = 10 * 60_000;
/** Wrong codes allowed before the form asks for a new one (for people; see the design). */
export const MAX_WRONG_CODES = 5;
/** Time between sends: Supabase's limit for one address. */
export const RESEND_AFTER_MS = 60_000;

export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

/** The code as typed or pasted, digits only ("123 456", "123-456" → "123456"). */
export const cleanCode = (typed: string) => typed.replace(/\D/g, "").slice(0, CODE_LENGTH);

/** Before asking Supabase: a message if the code can't be right, else null. */
export function checkCodeBeforeSending(code: string, sentAt: number, now = Date.now()): string | null {
  if (now - sentAt >= CODE_LIFE_MS) return "This code has expired. Send a new code.";
  if (code.length !== CODE_LENGTH) return "Enter the 6-digit code from the email.";
  return null;
}

/**
 * Supabase refused the code. `wrongSoFar` counts this one. Returns the
 * message and whether the field should now be locked until a new code.
 */
export function codeRefusedMessage(error: AuthErrorLike, wrongSoFar: number, sentAt: number, now = Date.now()) {
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return { message: "Too many tries from this device. Wait a few minutes, then try again.", locked: false };
  }
  if (now - sentAt >= CODE_LIFE_MS) return { message: "This code has expired. Send a new code.", locked: true };
  if (error.code === "otp_expired" || error.status === 403) {
    if (wrongSoFar >= MAX_WRONG_CODES) {
      return { message: `That's ${MAX_WRONG_CODES} wrong codes. Send a new code to try again.`, locked: true };
    }
    const left = MAX_WRONG_CODES - wrongSoFar;
    const tries = wrongSoFar >= 3 ? ` ${left === 1 ? "1 try" : `${left} tries`} left.` : "";
    return { message: `That code isn't right. Check the email and try again.${tries}`, locked: false };
  }
  return { message: "We couldn't check the code. Check your connection and try again.", locked: false };
}

/** Seconds Supabase says to wait before sending again, if it said. */
export function secondsToWait(error: AuthErrorLike): number | null {
  const m = error.message?.match(/after (\d+) seconds?/i);
  // Supabase rounds down, so the last second reads "after 0 seconds".
  return m ? Math.max(1, Number(m[1])) : null;
}

/** Sending the code failed. `admin`: an unknown address mustn't be revealed. */
export function sendFailedMessage(error: AuthErrorLike, { admin = false } = {}): string {
  const wait = secondsToWait(error);
  if (wait !== null) return `You can ask for a new code in ${wait} ${wait === 1 ? "second" : "seconds"}.`;
  if (error.status === 429) return "Too many sign-in emails for now. Wait a few minutes, then try again.";
  if (admin) return "We couldn't send a sign-in code. Check this is an admin's email address, or try again in a minute.";
  return "We couldn't send the code. Check your connection and try again.";
}

/** The resend button's text: "Send a new code", or the time left. */
export function resendLabel(sentAt: number, now = Date.now()): string {
  const left = Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000);
  return left > 0 ? `Send a new code in ${left} s` : "Send a new code";
}
