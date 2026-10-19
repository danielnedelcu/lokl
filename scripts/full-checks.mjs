// npm run check:full: every check, as run before each push (2026-10-19),
// timed. What shares nothing runs side by side; what shares the local
// database and the Stripe sandbox runs one at a time.
//
// First, six lanes at once (typecheck and the builds once db:test is done):
//   typecheck  typecheck
//   static     the source checks, the e2e types and @serial tags
//   database   db:test, db:types:check, check:public-cache, the realtime tests
//   build      build:check (the build the tests below run)
//   secrets    build:secrets-check (its own folders, .output-secrets)
//   unit       test:ui, test:emails, test:clock
// Then, one after another (they share the local database and Stripe):
//   the app tests, against the check build on ports 3300 and 3301 (beside
//   the dev servers on 3100 and 3101), then the browser tests, reusing the
//   same build (test:e2e -- --no-build).
//
// Each step's output goes to a log file (the folder is printed); the summary
// shows each step's time and result. Exits 1 if any step failed.
//
//   npm run check:full
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logs = path.join(os.tmpdir(), "lokl-full-checks", stamp);
fs.mkdirSync(logs, { recursive: true });

const results = [];
/** Runs one step, its output to its log; resolves with whether it passed. */
function step(name, command, args, env = {}) {
  const started = Date.now(); // real time: how long each check takes
  const log = fs.openSync(path.join(logs, `${name.replace(/[^a-z0-9-]+/gi, "_")}.log`), "w");
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", log, log] });
    child.on("close", (code) => {
      fs.closeSync(log);
      const r = { name, ok: code === 0, seconds: Math.round((Date.now() - started) / 1000) };
      results.push(r);
      console.log(`${r.ok ? "ok  " : "FAIL"} ${name} (${r.seconds}s)`);
      resolve(r.ok);
    });
  });
}
const npm = (name, script, ...extra) => step(name, "npm", ["run", script, ...(extra.length ? ["--", ...extra] : [])]);
/** Steps one after another; every one runs, whatever came before. */
async function lane(steps) {
  const ok = [];
  for (const s of steps) ok.push(await s());
  return ok.every(Boolean);
}
const skipped = (name) => {
  results.push({ name, ok: false, seconds: 0, skipped: true });
  console.log(`SKIP ${name} (a step it needs failed)`);
};

const begun = Date.now(); // real time: the run's own length
console.log(`Logs: ${logs}`);
// The builds and typecheck start only once db:test has rebuilt the local
// database (2026-10-19): beside them, its reset sometimes failed ("error
// running container") as Postgres's own workers reconnected mid-rebuild.
let resetDone = () => {};
const afterReset = new Promise((r) => { resetDone = r; });
const [, , database, build] = await Promise.all([
  lane([
    () => afterReset.then(() => npm("typecheck", "typecheck")),
  ]),
  lane([
    () => npm("check:reads", "check:reads"),
    () => npm("check:dates", "check:dates"),
    () => npm("check:rpc-json", "check:rpc-json"),
    () => npm("check:logs", "check:logs"),
    () => npm("check:booking-doc", "check:booking-doc"),
    () => npm("check:clock", "check:clock"),
    () => npm("check:e2e-serial", "check:e2e-serial"),
    () => npm("check:journey-pages", "check:journey-pages"),
    () => step("tsc-e2e", "npx", ["tsc", "-p", "e2e"]),
  ]),
  lane([
    () => npm("db:test", "db:test").finally(() => resetDone()),
    () => npm("db:types:check", "db:types:check"),
    () => npm("check:public-cache", "check:public-cache"),
    () => npm("db:test:realtime", "db:test:realtime"),
  ]),
  lane([() => afterReset.then(() => npm("build:check", "build:check"))]),
  lane([() => afterReset.then(() => npm("build:secrets-check", "build:secrets-check"))]),
  lane([
    () => npm("test:ui", "test:ui"),
    () => npm("test:emails", "test:emails"),
    () => npm("test:clock", "test:clock"),
  ]),
]);

// The app and browser tests need the database and the check build.
if (database && build) {
  const ports = { WEBSITE_PORT: "3300", ADMIN_PORT: "3301", WEBSITE_URL: "http://localhost:3300", ADMIN_URL: "http://localhost:3301" };
  const appsUp = await step("app tests: start apps", process.execPath, ["scripts/ci-start-apps.mjs"], ports);
  if (appsUp) await step("db:test:app", "npm", ["run", "db:test:app"], ports);
  else skipped("db:test:app");
  await step("app tests: stop apps", process.execPath, ["scripts/ci-start-apps.mjs", "--stop"], ports);
  // Each page the journeys land on is noted for check:quick (scripts/quick-checks.mjs).
  const visits = path.join(root, "node_modules/.cache/lokl/journey-visits.tsv");
  fs.mkdirSync(path.dirname(visits), { recursive: true });
  fs.writeFileSync(visits, "");
  await step("test:e2e", "npm", ["run", "test:e2e", "--", "--no-build"], { E2E_RECORD_VISITS: visits });
} else {
  skipped("db:test:app");
  skipped("test:e2e");
}

const total = Math.round((Date.now() - begun) / 1000);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} steps passed in ${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s. Logs: ${logs}`);
if (failed.length) console.log(`Failed: ${failed.map((r) => r.name + (r.skipped ? " (skipped)" : "")).join(", ")}`);
process.exit(failed.length ? 1 : 0);
