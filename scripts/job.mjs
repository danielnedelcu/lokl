// Runs one timed booking job against the local website (localhost:3100),
// with the job secret from apps/website/.env. The website's dev server must
// be running (npm run dev).
//
//   npm run job -- <name>
//   npm run job -- pay-out --booking <id> --as-of 2026-10-20T12:00:00Z
//   npm run job -- pay-out --booking <id> --as-of due   (just after its payout time)
//
// Jobs: expire-requests, release-reservations, withdraw-unavailable, pay-out,
// send-emails (sends or retries the booking emails that are due).
// --booking and --as-of (development only) run a job for one booking as if
// at a later time, for walkthroughs; --as-of needs --booking.
import fs from "node:fs";

const JOBS = ["expire-requests", "release-reservations", "withdraw-unavailable", "pay-out", "send-emails"];
const [name, ...rest] = process.argv.slice(2);
if (!JOBS.includes(name)) {
  console.error(`Usage: npm run job -- <${JOBS.join(" | ")}> [--booking <id>] [--as-of <time>]`);
  process.exit(1);
}
const flag = (f) => {
  const i = rest.indexOf(f);
  return i >= 0 ? rest[i + 1] : undefined;
};
const booking = flag("--booking");
const asOf = flag("--as-of");
if (asOf && !booking) {
  console.error("--as-of needs --booking, so only that booking is affected.");
  process.exit(1);
}

// The secret is read, never printed.
const envFile = new URL("../apps/website/.env", import.meta.url);
const line = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("NUXT_JOB_SECRET="))
  : undefined;
const secret = line?.slice("NUXT_JOB_SECRET=".length).trim().replace(/^["']|["']$/g, "");
if (!secret) {
  console.error("NUXT_JOB_SECRET isn't set in apps/website/.env (see .env.example). Add it and restart the dev server.");
  process.exit(1);
}

const url = new URL(`http://localhost:3100/api/jobs/${name}`);
if (booking) url.searchParams.set("bookingId", booking);
if (asOf) url.searchParams.set("asOf", asOf);
let res;
try {
  res = await fetch(url, { method: "POST", headers: { "x-job-secret": secret } });
} catch {
  console.error("Couldn't reach localhost:3100. Is the website's dev server running?");
  process.exit(1);
}
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`${res.status}: ${body.statusMessage ?? body.message ?? "the job failed"}`);
  process.exit(1);
}
console.log(`${body.job}: checked ${body.checked}, changed ${body.done.length}, failed ${body.failed.length}`);
for (const l of body.done) console.log(`  ${l}`);
for (const l of body.failed) console.log(`  FAILED ${l}`);
process.exit(body.failed.length ? 1 : 0);
