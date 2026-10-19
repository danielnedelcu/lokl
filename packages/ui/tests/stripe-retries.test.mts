// Stripe clients retry what Stripe says may be retried (STRIPE_CLIENT_OPTIONS,
// 2026-10-19), now that CI's Stripe jobs run side by side: a 429 lock
// timeout (two requests on one object at once, sent with
// Stripe-Should-Retry: true) is tried again with the same idempotency key.
// A 429 for the rate limit itself is NOT retried by Stripe's libraries
// (docs.stripe.com/rate-limits): CI watches for those instead, and fewer
// workers per shard is the remedy. A local server stands in for Stripe.
// Run: npx tsx packages/ui/tests/stripe-retries.test.mts (part of test:ui)

import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { safeStripe, STRIPE_CLIENT_OPTIONS } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };

/** A stand-in for Stripe: the first request gets `first`, later ones succeed. */
async function server(first: { headers: Record<string, string>; code: string }) {
  const seen: (string | undefined)[] = [];
  const s = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push(req.headers["idempotency-key"] as string | undefined);
      res.setHeader("content-type", "application/json");
      if (seen.length === 1) {
        res.statusCode = 429;
        for (const [k, v] of Object.entries(first.headers)) res.setHeader(k, v);
        res.end(JSON.stringify({ error: { type: "invalid_request_error", code: first.code, message: "Try again." } }));
        return;
      }
      res.end(JSON.stringify({ id: "re_test", object: "refund", amount: 100 }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  const stripe = safeStripe(new Stripe("sk_test_retries", { ...STRIPE_CLIENT_OPTIONS, host: "127.0.0.1", port, protocol: "http" }));
  const refund = () => stripe.refunds.create({ payment_intent: "pi_test", amount: 100 }, { idempotencyKey: "refund-retry-test" });
  return { seen, refund, close: () => s.close() };
}

// 1. A lock timeout: retried, with the same idempotency key.
const lock = await server({ headers: { "stripe-should-retry": "true" }, code: "lock_timeout" });
try {
  const r = await lock.refund();
  check(r.id === "re_test", "1a. a refund that met a lock timeout succeeds on the retry");
  check(lock.seen.length === 2, `1b. ...after one retry (${lock.seen.length} requests)`);
  check(lock.seen.every((k) => k === "refund-retry-test"), "1c. ...with the same idempotency key, so it can't happen twice");
} catch (e) {
  failures++;
  console.error(`FAIL 1. the request: ${(e as Error).message}`);
} finally {
  lock.close();
}

// 2. The rate limit itself: not retried by the library (watched for in CI).
const rate = await server({ headers: { "stripe-rate-limited-reason": "global-rate" }, code: "rate_limit" });
try {
  await rate.refund();
  check(false, "2a. a rate-limited request fails rather than being retried");
} catch {
  check(rate.seen.length === 1, `2a. a rate-limited request fails rather than being retried (${rate.seen.length} request)`);
} finally {
  rate.close();
}

console.log(failures ? `${failures} failed` : "All Stripe retry checks passed.");
process.exit(failures ? 1 : 0);
