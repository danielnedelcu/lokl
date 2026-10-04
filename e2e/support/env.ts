import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// What the journeys run against: the LOCAL Supabase stack and the Lokl
// Stripe sandbox, checked before anything is created. Keys are never printed.

export const WEBSITE = "http://localhost:3200";
export const ADMIN = "http://localhost:3201";
export const LOKL_SANDBOX = "acct_1UKIdIEfG7OyQ6pv";

export interface TestEnv {
  apiUrl: string;
  publishableKey: string;
  dbUrl: string;
  mailpitUrl: string;
  /** Service-role client, untyped: test setup writes rows in several schemas. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  stripe: Stripe;
  /** A connected test account that can receive transfers (for payouts). */
  connectedAccount: string;
  /** This run's secret for the timed-job routes (scripts/e2e.mjs). */
  jobSecret: string;
}

let cached: Promise<TestEnv> | null = null;

export function testEnv(): Promise<TestEnv> {
  cached ??= load();
  return cached;
}

async function load(): Promise<TestEnv> {
  const local = Object.fromEntries(
    execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
  );
  const apiUrl = local.API_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl)) throw new Error("Refusing to run: needs the local stack (`npx supabase start`).");

  const key = process.env.NUXT_STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/.test(key)) throw new Error("Refusing to run: needs a Stripe test-mode key (run through `npm run test:e2e`).");
  const stripe = new Stripe(key);
  if ((await stripe.accounts.retrieveCurrent()).id !== LOKL_SANDBOX) throw new Error("Refusing to run: the Stripe key isn't the Lokl sandbox's.");
  const connected = (await stripe.accounts.list({ limit: 100 })).data.find((a) => a.capabilities?.transfers === "active");
  if (!connected) throw new Error("Refusing to run: no connected test account in the Lokl sandbox can receive transfers.");

  const jobSecret = process.env.NUXT_JOB_SECRET ?? "";
  if (!jobSecret) throw new Error("Refusing to run: no job secret (run through `npm run test:e2e`).");

  return {
    apiUrl,
    publishableKey: (local.PUBLISHABLE_KEY || local.ANON_KEY)!,
    dbUrl: local.DB_URL!,
    mailpitUrl: (local.MAILPIT_URL || local.INBUCKET_URL)!,
    db: createClient(apiUrl, (local.SERVICE_ROLE_KEY || local.SECRET_KEY)!, { auth: { persistSession: false } }),
    stripe,
    connectedAccount: connected.id,
    jobSecret,
  };
}
