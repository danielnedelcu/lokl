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
import net from "node:net";

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
  NUXT_PUBLIC_SUPABASE_KEY: publishable,
  NUXT_SUPABASE_SECRET_KEY: secret,
  // Tests: a read cut off at the API's 1,000 rows fails (rowLimitFetch).
  NUXT_PUBLIC_ROW_LIMIT_CHECK: "throw",
  // ...and a database function's JSON that doesn't match its schema (rpcJson).
  NUXT_PUBLIC_RPC_SHAPE_CHECK: "throw",
  // No Google Analytics in tests, whatever the shell has set (the analytics
  // server below is the one exception).
  NUXT_PUBLIC_GTAG_ID: "",
  NUXT_PUBLIC_ANALYTICS_ALLOW_LOCAL: "",
};
const apps = [
  {
    name: "website",
    port: websitePort,
    env: {
      ...shared,
      NUXT_PUBLIC_SITE_URL: websiteUrl,
      // The website's sign-in cookie is named from the Supabase URL at build
      // time (a laptop's build sees the hosted project's .env); name it for
      // the local stack, as @supabase/ssr does, or every page reads as
      // signed out. Not the admin app's: it has its own fixed name
      // (supabase.cookiePrefix), so the two apps never share a session.
      NUXT_PUBLIC_SUPABASE_COOKIE_PREFIX: `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`,
      // A stand-in Google client, so the Google button is there to test; the
      // journeys stand in for Google's script and Supabase's answer (journey 23).
      NUXT_PUBLIC_GOOGLE_CLIENT_ID: "e2e-test-client.apps.googleusercontent.com",
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

// The end-to-end tests' analytics server (ANALYTICS_PORT, set only by
// scripts/e2e.mjs): the same website build with a made-up Google Analytics
// id and the localhost switch, so journeys 33 and 35 can see what would be
// sent. Every request to Google is caught by the tests and answered
// locally: nothing reaches Google. The main website above never gets an id.
const analyticsPort = Number(process.env.ANALYTICS_PORT || 0);
if (analyticsPort) {
  const website = apps[0];
  apps.push({
    name: "website-analytics",
    dir: "website",
    port: analyticsPort,
    env: {
      ...website.env,
      NUXT_PUBLIC_SITE_URL: `http://localhost:${analyticsPort}`,
      NUXT_PUBLIC_GTAG_ID: "G-E2ETEST000",
      NUXT_PUBLIC_ANALYTICS_ALLOW_LOCAL: "1",
    },
  });
}

// Each port must be free: an app left running (say, by a test run that was
// stopped) would answer in place of the new one, which then can't start, and
// the tests would run against the old build (seen 2026-10-17).
const answers = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
for (const app of apps) {
  if (await answers(app.port)) {
    console.error(`Port ${app.port} is already in use, so the ${app.name} can't start there. If it's an earlier test run's app, stop it: node scripts/ci-start-apps.mjs --stop (or find it with lsof -nP -iTCP:${app.port} -sTCP:LISTEN).`);
    process.exit(1);
  }
}

const pids = [];
for (const app of apps) {
  const server = new URL(`apps/${app.dir ?? app.name}/.output-check/server/index.mjs`, root);
  if (!fs.existsSync(server)) {
    console.error(`No build for the ${app.name}: run \`npm run build:check\` first.`);
    process.exit(1);
  }
  const log = fs.openSync(new URL(`apps/${app.dir ?? app.name}/.output-check/${app.name === (app.dir ?? app.name) ? "server" : app.name}.log`, root), "w");
  const child = spawn(process.execPath, [server.pathname], {
    // The server runs in Tokyo, ahead of Atlanta (the market) and of the
    // test browser (Los Angeles, or Auckland in the "ahead" project), so a
    // date that followed the server's zone shows up as wrong.
    env: { ...process.env, ...app.env, PORT: String(app.port), HOST: "127.0.0.1", NODE_ENV: "production", TZ: "Asia/Tokyo" },
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
      // The answer must come from the app just started, still running.
      process.kill(pids[apps.indexOf(app)], 0);
      console.log(`${app.name} is up on port ${app.port}.`);
      break;
    } catch {
      if (Date.now() > deadline) {
        console.error(`The ${app.name} didn't start within a minute. See its log in apps/${app.dir ?? app.name}/.output-check/.`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
