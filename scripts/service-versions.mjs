// Hosted's service versions, run everywhere (decided 2026-10-17).
// supabase/service-versions.json holds the versions hosted runs; the CLI
// reads a version for each service from supabase/.temp (written by
// `supabase link`, ignored by git), so without this CI ran the CLI's
// defaults (PostgREST 16.4 and Postgres 17.11 against hosted's 14.5 and
// 17.6).
//
//   node scripts/service-versions.mjs                 copy them into supabase/.temp
//                                                     (npm run db:start, db:test, CI before supabase start)
//   node scripts/service-versions.mjs --check-hosted  fail if hosted runs others (db:push, first)
//
// Copying also says if this project's running stack has other versions:
// they take effect when it's restarted (npx supabase stop, npm run db:start).
// When hosted moves, update the file in a commit of its own, so the change
// is tested everywhere before anything else.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const wanted = JSON.parse(fs.readFileSync(`${root}supabase/service-versions.json`, "utf8"));
// Each tracked service: its file in supabase/.temp, its name in `supabase services`, its container image.
const SERVICES = {
  postgres: { file: "postgres-version", hosted: "supabase/postgres", image: "postgres" },
  rest: { file: "rest-version", hosted: "postgrest/postgrest", image: "postgrest" },
  gotrue: { file: "gotrue-version", hosted: "supabase/gotrue", image: "gotrue" },
  storage: { file: "storage-version", hosted: "supabase/storage-api", image: "storage-api" },
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
for (const key of Object.keys(SERVICES)) if (!wanted[key]) fail(`supabase/service-versions.json has no "${key}".`);
for (const key of Object.keys(wanted)) if (!SERVICES[key]) fail(`supabase/service-versions.json has "${key}", which this script doesn't know.`);

if (process.argv.includes("--check-hosted")) {
  let out = "";
  try {
    out = execFileSync("npx", ["supabase", "services"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    fail(`Couldn't read hosted's versions (supabase services): ${String(e.stderr ?? e.message).split("\n")[0]}`);
  }
  const listed = JSON.parse(out.slice(out.indexOf("{"))).services ?? [];
  const moved = [];
  for (const [key, s] of Object.entries(SERVICES)) {
    const hosted = listed.find((x) => x.name === s.hosted)?.remote;
    if (!hosted) fail(`supabase services didn't say which ${s.hosted} hosted runs (is the project linked?).`);
    if (hosted !== wanted[key]) moved.push(`${key}: hosted runs ${hosted}, the file says ${wanted[key]}`);
  }
  if (moved.length) fail(`Hosted's services have moved:\n  ${moved.join("\n  ")}\nUpdate supabase/service-versions.json in a commit of its own, restart the local stack, and run the full checks.`);
  console.log("Hosted runs the versions in supabase/service-versions.json.");
  process.exit(0);
}

// Copy them into supabase/.temp, where the CLI reads them.
fs.mkdirSync(`${root}supabase/.temp`, { recursive: true });
for (const [key, s] of Object.entries(SERVICES)) fs.writeFileSync(`${root}supabase/.temp/${s.file}`, wanted[key]);
console.log(`Service versions for supabase start: ${Object.entries(wanted).map(([k, v]) => `${k} ${v}`).join(", ")}.`);

// This project's running stack, if any, on other versions?
const project = fs.readFileSync(`${root}supabase/config.toml`, "utf8").match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
let running = "";
try {
  running = execFileSync("docker", ["ps", "--format", "{{.Names}} {{.Image}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  process.exit(0); // no Docker: nothing running to compare
}
const stale = [];
for (const line of running.split("\n").filter((l) => project && l.split(" ")[0]?.endsWith(`_${project}`))) {
  const image = line.split(" ")[1] ?? "";
  for (const [key, s] of Object.entries(SERVICES)) {
    const m = image.match(new RegExp(`/${s.image}:(\\S+)$`));
    if (m && m[1] !== wanted[key]) stale.push(`${key} ${m[1]} (wanted ${wanted[key]})`);
  }
}
if (stale.length) {
  const message = `The running local stack has other versions: ${stale.join(", ")}. Restart it: npx supabase stop, then npm run db:start.`;
  if (process.argv.includes("--require-running")) fail(message);
  console.warn(message);
}
