import { createHash, timingSafeEqual } from "node:crypto";
import { serverSupabaseServiceRole } from "#supabase/server";
import { errorText, logText } from "@repo/types";

// POST /api/jobs/:name: one timed job (server/utils/bookingJobs.ts, and
// send-emails). Called by the scheduler: pg_cron in this environment's
// Supabase project, through public.run_scheduled_job() (decided 2026-10-21;
// switched off until hosting exists), and by `npm run job -- <name>` in
// development. Only with the shared secret in the x-job-secret header; no
// secret configured means no jobs.
//
// Each run:
// - takes the job's lease (job_start): one run of a job at a time; a call
//   while another runs answers "already running" and is counted as skipped;
// - has a budget (BUDGET_MS): it starts no new rows after it, as a host may
//   stop a request after a minute, and says the rest are waiting;
// - records how it went in job_status (every run), and in job_runs only when
//   it did something, failed, or left rows waiting (the history worth reading).
//
// Development only: ?bookingId=<id>&asOf=<time> runs the job for one booking
// as if at a later time, so a payout can be walked through without waiting.
// asOf=due means a minute after that booking's payout time. Production
// builds ignore both.

/** How long a scheduled run takes new rows for. */
const BUDGET_MS = 40_000;
/** How long a run holds its job before another may take over (a run the host stopped). */
const LEASE_SECONDS = 300;

// Compared as hashes, so neither the secret nor its length can be learned from timing.
const digest = (s: string) => createHash("sha256").update(s).digest();
function sameSecret(given: string, expected: string) {
  return timingSafeEqual(digest(given), digest(expected));
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
  // real time: when the run started (a record), and its budget.
  const started = new Date();
  opts.deadline = started.getTime() + BUDGET_MS;

  // One run of a job at a time.
  const { data: run, error: startError } = await db.rpc("job_start", { p_job: name, p_lease_seconds: LEASE_SECONDS });
  if (startError) {
    console.error("[jobs] couldn't start", name, errorText(startError));
    throw createError({ statusCode: 500, statusMessage: "The job couldn't start. Check the server logs." });
  }
  if (!run) return { job: name, skipped: "already running" };

  // job_runs keeps the runs worth reading: something done or failed, rows
  // left waiting, an error, or a walkthrough ("as of") run. It's
  // append-only, so its lines name rows by id, and any address or phone
  // number in an error is replaced.
  const log = async (r: { checked: number; done: string[]; failed: string[]; moreWaiting?: boolean } | null, error?: string) => {
    if (r && !error && !opts.now && !r.done.length && !r.failed.length && !r.moreWaiting) return;
    const { error: logError } = await db.from("job_runs").insert({
      job: opts.now ? `${name} (as of ${opts.now.toISOString()})` : name,
      started_at: started.toISOString(),
      checked: r?.checked ?? 0, changed: r?.done.length ?? 0, failed: r?.failed.length ?? 0,
      failures: (r?.failed ?? []).slice(0, 50).map((l) => logText(l, 300)),
      error: error ? logText(error, 1000) : null,
      more_waiting: r?.moreWaiting ?? false,
    });
    if (logError) console.error("[jobs] couldn't log the run", errorText(logError));
  };
  const finish = async (ok: boolean, error?: string) => {
    const { error: finishError } = await db.rpc("job_finish", { p_job: name, p_run: run, p_ok: ok, p_error: error ? logText(error, 500) : undefined });
    if (finishError) console.error("[jobs] couldn't record the run's end", errorText(finishError));
  };

  try {
    let result: { job: string; checked: number; done: string[]; failed: string[]; moreWaiting: boolean };
    // send-emails: retry what's due. Every other job then sends the emails
    // its changes queued, so they don't wait for the next send-emails run.
    if (name === "send-emails") {
      const { settings, mailer, adminUrl } = bookingEmailDeps();
      const r = await sendBookingEmails(db, mailer, settings, { bookingId: opts.bookingId, limit: 200, deadline: opts.deadline });
      if (!opts.bookingId) {
        const p = await sendProviderEmails(db, mailer, settings, { limit: 50, deadline: opts.deadline });
        const s = await sendSupportEmails(db, mailer, settings, { adminUrl, limit: 50, deadline: opts.deadline });
        const a = await sendAdminEmails(db, mailer, settings, { adminUrl, limit: 50, deadline: opts.deadline });
        for (const k of ["sent", "skipped", "retrying", "failed"] as const) r[k].push(...p[k], ...s[k], ...a[k]);
        r.more ||= p.more || s.more || a.more;
      }
      result = {
        job: name, checked: r.sent.length + r.retrying.length + r.failed.length + r.skipped.length,
        done: [...r.sent, ...r.skipped.map((l) => `skipped ${l}`)], failed: r.failed, moreWaiting: r.more,
      };
      if (r.retrying.length) result.done.push(...r.retrying.map((l) => `retrying ${l}`));
    } else {
      // Only the jobs that move money need Stripe (and its key).
      result = await runJob(name, db, STRIPE_JOBS.includes(name) ? useStripe() : null, opts);
      kickBookingEmails(event);
    }
    await log(result);
    await finish(true);
    console.info(`[jobs] ${name}: checked ${result.checked}, done ${result.done.length}, failed ${result.failed.length} (${Date.now() - started.getTime()} ms)`);
    // The answer carries the same cleaned lines as the record.
    return { ...result, failed: result.failed.map((l) => logText(l, 300)) };
  } catch (e) {
    const message = (e as Error).message;
    await log(null, message);
    await finish(false, message);
    throw createError({ statusCode: 500, statusMessage: logText(message, 300) });
  }
});
