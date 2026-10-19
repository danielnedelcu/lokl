// npm run check:quick (2026-10-19): the checks a change needs, while working.
// It never replaces npm run check:full, which runs everything before each
// push. It looks at what changed since origin/main (committed or not, and new
// files; --base <ref> for another starting point) and runs:
// - always: typecheck, the source checks, the unit tests (test:ui, test:emails,
//   test:clock) and the journey-page check;
// - the database tests, if a migration, a pgTAP file or a test helper changed;
// - the app tests whose imports, file by file, reach a changed file (all of
//   them if a migration changed; those that call the apps over HTTP if an
//   app's server code changed);
// - the browser journeys that name a changed page, or a page that uses a
//   changed component or composable (Nuxt auto-imports, followed up to the
//   pages), or that check:full saw reach it (node_modules/.cache); every
//   journey of an app whose layout, plugins or server changed, and all of
//   them for the shared layer or the test support;
// - the build, only if a selected test needs the apps.
//
//   npm run check:quick [-- --base <ref>] [-- --dry-run] [-- --files a,b]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { journeys, journeysFor, pageFor, pages, root } from "./journey-map.mjs";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
const dryRun = args.includes("--dry-run");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
// --files a,b: these files instead of git's list (to see what a change would pick).
const named = args.includes("--files") ? args[args.indexOf("--files") + 1].split(",").filter(Boolean) : null;
const changed = named ?? [...new Set([
  ...git("diff", "--name-only", `${base}...HEAD`),
  ...git("diff", "--name-only", "HEAD"),
  ...git("ls-files", "--others", "--exclude-standard"),
])];
const has = (re) => changed.some((f) => re.test(f));
const why = new Map(); // what -> reason
const pick = (what, reason) => { if (!why.has(what)) why.set(what, reason); };

console.log(`check:quick: ${changed.length} file${changed.length === 1 ? "" : "s"} changed since ${base}.`);
if (!changed.length) {
  console.log("Nothing to check. (npm run check:full still runs everything before a push.)");
  process.exit(0);
}

// ---- The database ---------------------------------------------------------
const dbChanged = has(/^supabase\/(migrations\/|tests\/[^/]+\.sql$|tests\/_helpers\/)/);
const migrationChanged = has(/^supabase\/migrations\//);
const publicCacheChanged = has(/^apps\/website\/server\/(api\/public\/|utils\/public)/) || has(/^scripts\/check-public-cache\.mjs$/);

// ---- App tests: imports, file by file -------------------------------------
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (["node_modules", ".nuxt", ".output", ".nuxt-check", ".output-check", ".nuxt-secrets", ".output-secrets"].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]) : []);
const rel = (f) => path.relative(root, f);
function resolveImport(from, spec) {
  if (spec === "@repo/types") return path.join(root, "packages/types/src/index.ts");
  if (!spec.startsWith(".")) return null;
  const b = path.resolve(path.dirname(from), spec);
  for (const c of [b, `${b}.ts`, `${b}.mts`, `${b}.mjs`, `${b}.vue`, path.join(b, "index.ts")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
const closures = new Map();
function importClosure(file) {
  if (closures.has(file)) return closures.get(file);
  const seen = new Set();
  const queue = [file];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const r = resolveImport(f, m[1]);
      if (r) queue.push(r);
    }
  }
  const out = new Set([...seen].map(rel));
  closures.set(file, out);
  return out;
}
// The app tests db:test:app runs (not booking-checkout, which waits for a person to pay).
const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
const appTests = [...new Set(`${scripts["db:test:app:core"]} ${scripts["db:test:app:stripe"]}`.match(/supabase\/tests\/app\/[\w.-]+\.test\.mts/g))].map((f) => path.join(root, f));
/** A test that calls the apps over HTTP (not one that only names their address in a link). */
const overHttp = (f) => /fetch\([^)]*(WEBSITE_URL|ADMIN_URL|localhost:310[01])/.test(fs.readFileSync(f, "utf8"));
const appServerChanged = has(/^apps\/(website|admin)\/server\//);
const selectedAppTests = [];
for (const t of appTests) {
  const name = rel(t);
  const hit = [...importClosure(t)].find((f) => changed.includes(f));
  if (migrationChanged) selectedAppTests.push([name, "a migration changed"]);
  else if (hit) selectedAppTests.push([name, `imports ${hit}`]);
  else if (appServerChanged && overHttp(t)) selectedAppTests.push([name, "calls the apps, whose server code changed"]);
}

// ---- Browser journeys -----------------------------------------------------
const allPages = pages();
const allJourneys = journeys();
const recorded = (() => {
  const f = path.join(root, "node_modules/.cache/lokl/journey-visits.tsv");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
})();
const journeysOfPage = (p) => new Set([
  ...journeysFor(p, allJourneys, { strict: true }),
  ...recorded.filter(([, app, u]) => app === p.app && pageFor(app, u.replace(/\/$/, "") || "/", allPages)?.file === p.file).map(([j]) => j),
]);
const selectedJourneys = new Map();
const addJourneys = (list, reason) => { for (const j of list) if (!selectedJourneys.has(j)) selectedJourneys.set(j, reason); };
const everyJourney = (reason, app) => addJourneys(allJourneys.filter((j) => !app || j.visits.some((v) => v.app === app)).map((j) => j.file), reason);

// The names a file gives Nuxt: a component's (path under components/, joined),
// and what a composable or utility exports.
function namesOf(file) {
  const names = [];
  const comp = file.match(/(?:^|\/)components\/(.+)\.vue$/);
  if (comp) names.push(comp[1].split("/").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("").replace(/[-_](\w)/g, (_, c) => c.toUpperCase()));
  if (/\/(composables|utils)\/[^/]+\.ts$/.test(file) && fs.existsSync(path.join(root, file))) {
    for (const m of fs.readFileSync(path.join(root, file), "utf8").matchAll(/export (?:async )?(?:function|const) (\w+)/g)) names.push(m[1]);
  }
  return names;
}
const appFiles = (app) => walk(path.join(root, "apps", app, "app")).filter((f) => /\.(vue|ts)$/.test(f)).map(rel);
const usersOf = (names, files) => files.filter((f) => {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  return names.some((n) => new RegExp(`(<${n}\\b|\\b${n}\\()`).test(src) || new RegExp(`<${n.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}\\b`).test(src));
});
for (const f of changed) {
  const m = f.match(/^apps\/(website|admin)\/app\/(.+)$/);
  const shared = f.startsWith("packages/ui/app/");
  if (/^e2e\/journeys\/.+\.spec\.ts$/.test(f) && fs.existsSync(path.join(root, f))) { addJourneys([f], "the journey itself changed"); continue; }
  if (/^e2e\/(support\/|playwright\.config\.ts)/.test(f) || f === "scripts/e2e.mjs") { everyJourney(`${f} changed (the browser tests' support)`); continue; }
  if (shared && !/\.(vue|ts)$/.test(f)) continue;
  if (shared && /\/(plugins|layouts|middleware)\//.test(f)) { everyJourney(`${f} changed (both apps' layer)`); continue; }
  if (m && /^(layouts|plugins|middleware|app\.vue|error\.vue)/.test(m[2])) { everyJourney(`${f} changed`, m[1]); continue; }
  if (/^apps\/(website|admin)\/server\//.test(f)) { everyJourney(`${f} changed (the app's server)`, f.split("/")[1]); continue; }
  if (!m && !shared) continue;
  // A page: its journeys. A component or composable: up to the pages using it.
  const apps = shared ? ["website", "admin"] : [m[1]];
  for (const app of apps) {
    const files = appFiles(app);
    const seen = new Set([f]);
    let frontier = [f];
    const reachedPages = new Set();
    let reachedLayout = false;
    for (let depth = 0; depth < 8 && frontier.length; depth++) {
      const next = [];
      for (const g of frontier) {
        if (/\/pages\/.+\.vue$/.test(g)) { reachedPages.add(g); continue; }
        if (/\/(layouts|plugins|middleware)\/|\/app\.vue$/.test(g)) { reachedLayout = true; continue; }
        for (const u of usersOf(namesOf(g), files)) if (!seen.has(u)) { seen.add(u); next.push(u); }
      }
      frontier = next;
    }
    if (reachedLayout) everyJourney(`${f} is used by ${app}'s layout`, app);
    for (const pg of reachedPages) {
      const page = allPages.find((p) => p.file === pg);
      if (page) addJourneys([...journeysOfPage(page)], pg === f ? `${pg} changed` : `${f} is used by ${pg}`);
    }
  }
}
if (selectedJourneys.size >= allJourneys.length * 0.7) everyJourney("most journeys were picked: all of them");

// ---- The plan --------------------------------------------------------------
const plan = [];
const add = (name, cmd, cmdArgs, reason, env = {}) => plan.push({ name, cmd, cmdArgs, reason, env });
add("typecheck", "npm", ["run", "typecheck"], "always");
for (const c of ["check:reads", "check:dates", "check:rpc-json", "check:logs", "check:booking-doc", "check:clock", "check:e2e-serial", "check:journey-pages"]) add(c, "npm", ["run", c], "always");
add("test:ui", "npm", ["run", "test:ui"], "always");
add("test:emails", "npm", ["run", "test:emails"], "always");
add("test:clock", "npm", ["run", "test:clock"], "always");
if (has(/^e2e\//)) add("tsc-e2e", "npx", ["tsc", "-p", "e2e"], "the browser tests changed");
if (dbChanged) {
  add("db:test", "npm", ["run", "db:test"], "a migration or pgTAP test changed");
  add("db:types:check", "npm", ["run", "db:types:check"], "a migration or pgTAP test changed");
}
if (dbChanged || publicCacheChanged) add("check:public-cache", "npm", ["run", "check:public-cache"], dbChanged ? "the database changed" : "a cached public route changed");
if (migrationChanged) add("db:test:realtime", "npm", ["run", "db:test:realtime"], "a migration changed");
if (has(/(^|\/)nuxt\.config\.ts$|\.env\.example$|^scripts\/build-(check|secrets-check)\.mjs$/)) add("build:secrets-check", "npm", ["run", "build:secrets-check"], "a build setting changed");
const needsApps = selectedJourneys.size > 0 || selectedAppTests.some(([t]) => overHttp(path.join(root, t)));
if (needsApps) add("build:check", "npm", ["run", "build:check"], "a selected test needs the apps");
const ports = { WEBSITE_PORT: "3300", ADMIN_PORT: "3301", WEBSITE_URL: "http://localhost:3300", ADMIN_URL: "http://localhost:3301" };
const appTestPrefix = ["--import", "./supabase/tests/app/_rowLimitCheck.mts", "--import", "./supabase/tests/app/_safeOutput.mts"];
for (const [t, reason] of selectedAppTests) add(path.basename(t), "npx", ["tsx", ...appTestPrefix, t], reason, ports);
if (selectedJourneys.size) add(`test:e2e (${selectedJourneys.size} journey${selectedJourneys.size === 1 ? "" : "s"})`, "npm", ["run", "test:e2e", "--", "--no-build", ...[...selectedJourneys.keys()].map((j) => j.replace(/^e2e\//, ""))], "picked below");

console.log("\nThe plan:");
for (const p of plan) console.log(`  ${p.name.padEnd(36)} ${p.reason}`);
if (selectedJourneys.size) for (const [j, r] of selectedJourneys) console.log(`    ${j.replace("e2e/journeys/", "").padEnd(34)} ${r}`);
if (dryRun) process.exit(0);

// ---- Running it -------------------------------------------------------------
const results = [];
const begun = Date.now(); // real time: the run's own length
let appsUp = false;
for (const p of plan) {
  if (p.env.WEBSITE_PORT && !appsUp) {
    appsUp = spawnSync(process.execPath, ["scripts/ci-start-apps.mjs"], { cwd: root, env: { ...process.env, ...ports }, stdio: "ignore" }).status === 0;
    if (!appsUp) { results.push({ name: p.name, ok: false, seconds: 0 }); console.log(`FAIL ${p.name} (the apps didn't start)`); continue; }
  }
  const started = Date.now(); // real time: how long each check takes
  const r = spawnSync(p.cmd, p.cmdArgs, { cwd: root, env: { ...process.env, ...p.env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const ok = r.status === 0;
  results.push({ name: p.name, ok, seconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${ok ? "ok  " : "FAIL"} ${p.name} (${results.at(-1).seconds}s)`);
  if (!ok) console.log((r.stdout + r.stderr).split("\n").filter((l) => /FAIL|✘|Error|error|failed/.test(l)).slice(0, 12).map((l) => `       ${l}`).join("\n"));
}
if (appsUp) spawnSync(process.execPath, ["scripts/ci-start-apps.mjs", "--stop"], { cwd: root, env: { ...process.env, ...ports }, stdio: "ignore" });
const failed = results.filter((r) => !r.ok);
const total = Math.round((Date.now() - begun) / 1000);
console.log(`\n${results.length - failed.length} of ${results.length} passed in ${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s. Run npm run check:full before pushing: it runs everything.`);
process.exit(failed.length ? 1 : 0);
