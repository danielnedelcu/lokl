// Run by secret-leaks.test.mts: a process with only the output backstop
// (installRedactingOutput), printing a raw Stripe error every way a server
// could, then dying of it. The parent fails if any part of the key shows.
import { installRedactingOutput } from "@repo/types";

installRedactingOutput();
const raw = JSON.parse(process.env.RAW_ERROR ?? "{}") as { message: string; stack: string };
const err = Object.assign(new Error(raw.message), { type: "StripeAuthenticationError", raw: { message: raw.message } });
console.error("[jobs] pay-out", err);
console.warn("[bookings] expire", raw.message);
console.log({ failure: raw.message });
process.stdout.write(`${raw.message}\n`);
process.stderr.write(Buffer.from(`${raw.message}\n`));
throw err;
