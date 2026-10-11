// A request whose reply never arrived (a dropped connection, a timeout): the
// server may well have finished it. Money actions are safe to repeat (the
// lost-reply check, 2026-10-11), so after a lost reply a page re-reads where
// things stand: done means success; not done means it's safe to try again.
// Never "it didn't go through" when it may have.

/** True when the request got no answer at all (no HTTP status). */
export function isLostReply(e: unknown): boolean {
  const err = e as { statusCode?: number; status?: number; response?: unknown; lost?: boolean } | null;
  if (err?.lost !== undefined) return err.lost;
  return !err?.statusCode && !err?.status && !err?.response;
}

export const LOST_REPLY_TRY_AGAIN = "We didn't hear back, and it hasn't gone through yet. Please try again: it won't be done twice.";
