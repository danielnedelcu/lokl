// End-to-end tests (e2e/, Playwright): builds both apps, starts them on
// ports 3200 and 3201 against the LOCAL Supabase stack (so the dev servers
// on 3100/3101, which use the hosted project, are never involved), runs the
// tests, then stops the apps.
//
//   npm run test:e2e                      build, start, test, stop
//   npm run test:e2e -- --no-build        reuse the last build:check output
//   npm run test:e2e -- --grep "Service"  anything after is passed to Playwright
//
// Needs the local stack (`npx supabase start`) and a Stripe TEST key for the
// Lokl sandbox: NUXT_STRIPE_SECRET_KEY from the environment (CI's
// stripe-sandbox secret), or else the website's .env. The tests check it's
// the Lokl sandbox before doing anything (e2e/support/env.ts).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const build = !args.includes("--no-build");
const playwrightArgs = args.filter((a) => a !== "--no-build");

function stripeKey() {
  if (process.env.NUXT_STRIPE_SECRET_KEY?.trim()) return process.env.NUXT_STRIPE_SECRET_KEY.trim();
  const file = new URL("apps/website/.env", root);
  if (!fs.existsSync(file)) return "";
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("NUXT_STRIPE_SECRET_KEY="));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
}
const key = stripeKey();
if (!/^(sk|rk)_test_/.test(key)) {
  console.error("Refusing to run: needs a Stripe test-mode key for the Lokl sandbox (NUXT_STRIPE_SECRET_KEY).");
  process.exit(1);
}

const env = {
  ...process.env,
  NUXT_STRIPE_SECRET_KEY: key,
  NUXT_JOB_SECRET: randomBytes(32).toString("hex"),
  WEBSITE_PORT: "3200",
  ADMIN_PORT: "3201",
};
const step = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { cwd: root, env, stdio: "inherit" }).status ?? 1;

if (build && step("npm", ["run", "build:check"]) !== 0) process.exit(1);
if (step(process.execPath, ["scripts/ci-start-apps.mjs"]) !== 0) process.exit(1);
let status = 1;
try {
  status = step("npx", ["playwright", "test", "--config", "e2e/playwright.config.ts", ...playwrightArgs]);
} finally {
  step(process.execPath, ["scripts/ci-start-apps.mjs", "--stop"]);
}
process.exit(status);
