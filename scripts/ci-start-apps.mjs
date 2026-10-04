// Starts both apps from their build-check output (npm run build:check)
// against the LOCAL Supabase stack, for the app tests in CI
// (.github/workflows/ci.yml). The tests call http://localhost:3100 (website)
// and :3101 (admin), so those are the defaults; WEBSITE_PORT and ADMIN_PORT
// change them (to try this beside running dev servers).
//
//   node scripts/ci-start-apps.mjs          start both, wait until they answer
//   node scripts/ci-start-apps.mjs --stop   stop the ones this script started
//
// Local keys come from `supabase status` and are never printed. It refuses
// anything but a local stack. Email is off and there's no Anthropic key.
// The website gets a Stripe key only when NUXT_STRIPE_SECRET_KEY is set (the
// end-to-end tests, scripts/e2e.mjs), and only a test-mode one; the admin
// app never gets one. NUXT_JOB_SECRET, when set, is used instead of a fresh
// random one, so a test can call the timed-job routes.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const pidFile = new URL("node_modules/.cache/ci-apps.pids", root);
const websitePort = Number(process.env.WEBSITE_PORT ?? 3100);
const adminPort = Number(process.env.ADMIN_PORT ?? 3101);

if (process.argv.includes("--stop")) {
  if (fs.existsSync(pidFile)) {
    for (const pid of fs.readFileSync(pidFile, "utf8").split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid));
      } catch {
        // already stopped
      }
    }
    fs.rmSync(pidFile);
  }
  console.log("Stopped the apps.");
  process.exit(0);
}

const local = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const apiUrl = local.API_URL ?? "";
const publishable = local.PUBLISHABLE_KEY || local.ANON_KEY;
const secret = local.SECRET_KEY || local.SERVICE_ROLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl) || !publishable || !secret) {
  console.error("Refusing to start: needs the local stack (`npx supabase start`).");
  process.exit(1);
}

const stripeKey = process.env.NUXT_STRIPE_SECRET_KEY ?? "";
if (stripeKey && !/^(sk|rk)_test_/.test(stripeKey)) {
  console.error("Refusing to start: NUXT_STRIPE_SECRET_KEY isn't a test-mode key.");
  process.exit(1);
}

const websiteUrl = `http://localhost:${websitePort}`;
const adminUrl = `http://localhost:${adminPort}`;
const shared = {
  NUXT_PUBLIC_SUPABASE_URL: apiUrl,
  // The sign-in cookie's name is fixed at build time from the Supabase URL
  // then in use (a laptop's build sees the hosted project's .env); name it
  // for the local stack, as @supabase/ssr does, or every page reads as
  // signed out.
  NUXT_PUBLIC_SUPABASE_COOKIE_PREFIX: `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`,
  NUXT_PUBLIC_SUPABASE_KEY: publishable,
  NUXT_SUPABASE_SECRET_KEY: secret,
};
const apps = [
  {
    name: "website",
    port: websitePort,
    env: {
      ...shared,
      NUXT_PUBLIC_SITE_URL: websiteUrl,
      NUXT_ADMIN_ORIGIN: adminUrl,
      NUXT_EMAIL_MODE: "off",
      NUXT_STRIPE_SECRET_KEY: stripeKey,
      // Only for this run's timed-job routes; made fresh unless given.
      NUXT_JOB_SECRET: process.env.NUXT_JOB_SECRET || randomBytes(32).toString("hex"),
    },
  },
  // Never a Stripe key in the admin app.
  { name: "admin", port: adminPort, env: { ...shared, NUXT_PUBLIC_WEBSITE_URL: websiteUrl, NUXT_STRIPE_SECRET_KEY: "" } },
];

const pids = [];
for (const app of apps) {
  const server = new URL(`apps/${app.name}/.output-check/server/index.mjs`, root);
  if (!fs.existsSync(server)) {
    console.error(`No build for the ${app.name}: run \`npm run build:check\` first.`);
    process.exit(1);
  }
  const log = fs.openSync(new URL(`apps/${app.name}/.output-check/server.log`, root), "w");
  const child = spawn(process.execPath, [server.pathname], {
    env: { ...process.env, ...app.env, PORT: String(app.port), HOST: "127.0.0.1", NODE_ENV: "production" },
    stdio: ["ignore", log, log],
    detached: true,
  });
  child.unref();
  pids.push(child.pid);
}
fs.mkdirSync(new URL("node_modules/.cache/", root), { recursive: true });
fs.writeFileSync(pidFile, pids.join("\n"));

// Wait until each answers (any HTTP status counts: the server is up).
const deadline = Date.now() + 60_000;
for (const app of apps) {
  for (;;) {
    try {
      await fetch(`http://localhost:${app.port}/`, { signal: AbortSignal.timeout(2000) });
      console.log(`${app.name} is up on port ${app.port}.`);
      break;
    } catch {
      if (Date.now() > deadline) {
        console.error(`The ${app.name} didn't start within a minute. See apps/${app.name}/.output-check/server.log.`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
