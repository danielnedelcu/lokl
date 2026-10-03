import { serverSupabaseServiceRole } from "#supabase/server";
import type { ServerEvent } from "./provider";

// The website's side of the booking emails: settings from runtimeConfig, and
// a "send what's due now" that never holds up or fails the request that
// queued the email (the send-emails job retries anything left).
export function bookingEmailDeps() {
  const config = useRuntimeConfig();
  const settings = emailSettings(config, config.public.siteUrl);
  return { settings, mailer: config.resendApiKey ? resendMailer(config.resendApiKey) : null };
}

export function kickBookingEmails(event: ServerEvent, bookingId?: string) {
  const { settings, mailer } = bookingEmailDeps();
  const db = serverSupabaseServiceRole(event);
  // Booking emails, then any provider account emails waiting (paused,
  // active again), which are few.
  const run = sendBookingEmails(db, mailer, settings, { bookingId, limit: 20 })
    .then(async (r) => {
      const p = await sendProviderEmails(db, mailer, settings, { limit: 10 });
      for (const k of ["sent", "skipped", "retrying", "failed"] as const) r[k].push(...p[k]);
      return r;
    })
    .then((r) => {
      if (r.sent.length || r.failed.length || r.retrying.length) {
        console.info(`[emails] sent ${r.sent.length}, retrying ${r.retrying.length}, failed ${r.failed.length}, skipped ${r.skipped.length}`);
      }
    })
    .catch((e) => console.error("[emails] kick", e));
  // Let the response go first; on hosts that stop work after responding,
  // waitUntil keeps it running.
  (event as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil?.(run);
}
