import { timingSafeEqual } from "node:crypto";
import { serverSupabaseServiceRole } from "#supabase/server";

// POST /api/jobs/:name: one timed booking job (server/utils/bookingJobs.ts).
// Called by `npm run job -- <name>` in development and, after launch, by the
// scheduler (docs/design/booking-and-checkout.md, Jobs). Only with the shared
// secret in the x-job-secret header; no secret configured means no jobs.
//
// Development only: ?bookingId=<id>&asOf=<time> runs the job for one booking
// as if at a later time, so a payout can be walked through without waiting.
// asOf=due means a minute after that booking's payout time. Production
// builds ignore both.
function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default defineEventHandler(async (event) => {
  const expected = useRuntimeConfig().jobSecret;
  const given = getHeader(event, "x-job-secret") ?? "";
  if (!expected || !sameSecret(given, expected)) {
    throw createError({ statusCode: 401, statusMessage: "Not allowed." });
  }
  const name = getRouterParam(event, "name") as JobName | "send-emails";
  if (name !== "send-emails" && !JOB_NAMES.includes(name)) throw createError({ statusCode: 404, statusMessage: "No such job." });

  const opts: JobOptions = {};
  if (import.meta.dev) {
    const { bookingId, asOf } = getQuery(event);
    if (typeof bookingId === "string" && bookingId) opts.bookingId = bookingId;
    if (typeof asOf === "string" && asOf) {
      if (!opts.bookingId) throw createError({ statusCode: 400, statusMessage: "asOf needs a bookingId, so only that booking is affected." });
      let at = new Date(asOf);
      if (asOf === "due") {
        const { data } = await serverSupabaseServiceRole(event).from("bookings").select("payout_due_at").eq("id", opts.bookingId).maybeSingle();
        if (!data?.payout_due_at) throw createError({ statusCode: 400, statusMessage: "That booking has no payout time (it isn't confirmed)." });
        at = new Date(Date.parse(data.payout_due_at) + 60_000);
      }
      if (Number.isNaN(at.getTime())) throw createError({ statusCode: 400, statusMessage: "asOf isn't a date and time." });
      opts.now = at;
    }
  }

  const db = serverSupabaseServiceRole(event);
  const started = new Date();
  // Every run is logged in job_runs, for the admin's "needs attention" list,
  // including one that crashes.
  const log = async (r: { checked: number; done: string[]; failed: string[] } | null, error?: string) => {
    const { error: logError } = await db.from("job_runs").insert({
      job: opts.now ? `${name} (as of ${opts.now.toISOString()})` : name,
      started_at: started.toISOString(),
      checked: r?.checked ?? 0, changed: r?.done.length ?? 0, failed: r?.failed.length ?? 0,
      failures: (r?.failed ?? []).slice(0, 50).map((l) => l.slice(0, 300)),
      error: error?.slice(0, 1000) ?? null,
    });
    if (logError) console.error("[jobs] couldn't log the run", logError.message);
  };

  try {
    let result: { job: string; checked: number; done: string[]; failed: string[] };
    // send-emails: retry what's due. Every other job then sends the emails
    // its changes queued, so they don't wait for the next send-emails run.
    if (name === "send-emails") {
      const { settings, mailer } = bookingEmailDeps();
      const r = await sendBookingEmails(db, mailer, settings, { bookingId: opts.bookingId, limit: 200 });
      if (!opts.bookingId) {
        const p = await sendProviderEmails(db, mailer, settings, { limit: 50 });
        for (const k of ["sent", "skipped", "retrying", "failed"] as const) r[k].push(...p[k]);
      }
      result = {
        job: name, checked: r.sent.length + r.retrying.length + r.failed.length + r.skipped.length,
        done: [...r.sent, ...r.skipped.map((l) => `skipped ${l}`)], failed: r.failed,
      };
      if (r.retrying.length) result.done.push(...r.retrying.map((l) => `retrying ${l}`));
    } else {
      result = await runJob(name, db, useStripe(), opts);
      kickBookingEmails(event);
    }
    await log(result);
    console.info(`[jobs] ${name}: checked ${result.checked}, done ${result.done.length}, failed ${result.failed.length} (${Date.now() - started.getTime()} ms)`);
    return result;
  } catch (e) {
    await log(null, (e as Error).message);
    throw e;
  }
});
