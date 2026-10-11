// Keys and key fragments never reach logs or stored text (packages/types/src/
// secrets.ts and logs.ts; sanitising Stripe errors, 2026-10-11). Stripe's
// errors quote a key masked to its prefix and last four, which GitHub
// doesn't mask. Each layer is checked on its own: safeStripe (errors
// redacted where they happen), logText and stripeErrorSummary (anything
// stored or logged), and the output backstop (a process's stdout and
// stderr, uncaught errors included). Uses a fake key: one real call to
// Stripe, which always answers 401, and errors built offline.
// Run: npx tsx packages/ui/tests/secret-leaks.test.mts (part of `npm run test:ui`).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { logText, redactSecrets, safeStripe, stripeErrorSummary } from "@repo/types";

const require = createRequire(new URL("../../../apps/website/package.json", import.meta.url));
const Stripe = require("stripe") as typeof import("stripe").default;

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const FAKE = "sk_test_FAKEonlyForLeakTests000Qx7Z";
const LAST4 = "Qx7Z";
const leaks = (s: string) => s.includes(LAST4) || s.includes(FAKE) || /sk_test_\*+/.test(s);

// 0. redactSecrets: every key shape goes; ids stay.
const shapes = [
  "sk_test_51abcDEF", "sk_live_51abcDEF", "rk_test_51abcDEF", "pk_live_51abcDEF", "pk_test_51abc", "sk_test_****************abcd",
  "whsec_abc123DEF", "pi_3Abc_secret_xyz789", "seti_1Abc_secret_xyz", "sb_secret_abc-DEF_123", "sb_publishable_abcDEF",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "Bearer abc.def-ghi",
];
check(shapes.every((s) => !redactSecrets(`x ${s} y`).includes(s)), "0a. every key shape is redacted (Stripe keys whole or masked, webhook and client secrets, Supabase keys, JWTs, Bearer)");
const ids = ["acct_1UKIdIEfG7OyQ6pv", "pi_3Pq0abc", "ch_3Pq0abc", "tr_1Abc", "cs_test_a1B2c3", "cus_Abc", "re_3Abc", "dp_1Abc", "req_abc123"];
check(ids.every((s) => redactSecrets(`x ${s} y`).includes(s)), "0b. ids that aren't secrets are kept (acct_, pi_, ch_, tr_, cs_test_, cus_, re_, dp_, req_)");

// A raw error from Stripe for the fake key (the plain client, no layers).
let rawError: { message: string; stack: string; type: string; statusCode?: number; requestId?: string } = { message: "", stack: "", type: "" };
try {
  await new Stripe(FAKE).accounts.retrieve();
} catch (e) {
  rawError = e as typeof rawError;
}
check(leaks(rawError.message), `(the raw message does carry the fragment: "${rawError.message.replace(LAST4, "____")}")`);

// 1. safeStripe: the same call's error is redacted where it happens,
//    keeping its class and fields.
let safe: { message: string; stack: string; type: string; statusCode: number; raw: { message: string } } | null = null;
try {
  await safeStripe(new Stripe(FAKE)).accounts.retrieve();
} catch (e) {
  safe = e as typeof safe;
}
check(!!safe && !leaks(`${safe.message} ${safe.stack} ${safe.raw?.message}`), "1a. safeStripe: a live error's message, stack and raw message carry no part of the key");
check(safe?.type === "StripeAuthenticationError" && safe.statusCode === 401 && safe instanceof Stripe.errors.StripeAuthenticationError,
  "1b. ...and it's still a StripeAuthenticationError, status 401 (our code reads type and code)");
// Offline: a Stripe error built locally, thrown by a wrapped client, sync and async.
const built = () => new Stripe.errors.StripeAuthenticationError({ message: `Invalid API Key provided: sk_test_********************${LAST4}`, type: "authentication_error" } as never);
const fakeClient = safeStripe({ things: { list: () => Promise.reject(built()), now: () => { throw built(); } } });
let offline = "";
await fakeClient.things.list().catch((e: Error) => { offline += `${e.message} ${e.stack}`; });
try { fakeClient.things.now(); } catch (e) { offline += `${(e as Error).message} ${(e as Error).stack}`; }
check(offline.length > 0 && !leaks(offline), "1c. safeStripe: errors built offline, rejected or thrown, are redacted too");

// 2. logText and stripeErrorSummary, given the raw (unredacted) error.
const withEmail = `${rawError.message} for sam.lee@example.com`;
check(!leaks(logText(`booking 1: ${withEmail}`, 500)), "2a. logText (job_runs, last_error, payout_failure, reversal_failure) stores no part of the key");
const summary = stripeErrorSummary({ ...rawError, message: withEmail, requestId: "req_test123" });
check(!leaks(summary) && !summary.includes("sam.lee@example.com"), "2b. stripeErrorSummary: no part of the key, no email address");
check(summary.startsWith("StripeAuthenticationError 401 req_test123: Invalid API Key provided: [key]"), `2c. ...but the type, status and request id ("${summary.slice(0, 80)}")`);

// 3. The output backstop: a process printing the raw error every way, then dying of it.
let output = "";
try {
  execFileSync("npx", ["tsx", new URL("./_leak-child.mts", import.meta.url).pathname], {
    env: { ...process.env, RAW_ERROR: JSON.stringify({ message: rawError.message, stack: rawError.stack }) }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  output = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
}
check(output.includes("[key]"), "3a. (the child printed the error and died of it)");
check(!leaks(output), "3b. the backstop: console.error, warn, log, direct writes and an uncaught error show no part of the key");

console.log(failures ? `${failures} failed` : "All secret leak checks passed.");
process.exit(failures ? 1 : 0);
