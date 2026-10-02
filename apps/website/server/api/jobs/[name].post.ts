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
  const name = getRouterParam(event, "name") as JobName;
  if (!JOB_NAMES.includes(name)) throw createError({ statusCode: 404, statusMessage: "No such job." });

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

  const started = Date.now();
  const result = await runJob(name, serverSupabaseServiceRole(event), useStripe(), opts);
  console.info(`[jobs] ${name}: checked ${result.checked}, done ${result.done.length}, failed ${result.failed.length} (${Date.now() - started} ms)`);
  return result;
});
