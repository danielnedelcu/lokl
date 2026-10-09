// npm run schema:compare: is the hosted database exactly what the migrations
// build? (docs/TODO.md; a practice from The Reserve, 2026-10-09.)
//
// Builds the local database from the migrations (supabase db reset --local;
// --no-reset uses it as it is, as db:push does after db:test), reads both
// catalogues with scripts/schema-catalog.sql, and prints every difference.
// Anything changed by hand on hosted (the SQL editor, the dashboard) shows
// up here. Zero differences is required after every db:push and before
// every deploy; it exits 1 otherwise.
//
// Hosted is read through TBLS_DSN (the root .env, or the environment), in
// read-only transactions. The connection string is never printed: errors
// are reported without it.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const catalog = new URL("schema-catalog.sql", import.meta.url).pathname;
const args = process.argv.slice(2);

function envValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  const file = `${root}.env`;
  if (!fs.existsSync(file)) return "";
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}
const scrub = (text) => text.replace(/postgres(ql)?:\/\/\S+/g, "<connection string>");

function readCatalog(url, label, extraEnv = {}) {
  const r = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", catalog], {
    encoding: "utf8", env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`Couldn't read the ${label} catalogue: ${scrub(r.stderr || r.error?.message || "unknown error").trim()}`);
    process.exit(2);
  }
  return new Set(r.stdout.split("\n").filter(Boolean));
}

const hosted = envValue("TBLS_DSN");
if (!hosted) {
  console.error("Refusing to run: needs TBLS_DSN (the hosted database) in the root .env.");
  process.exit(2);
}
if (!args.includes("--no-reset")) {
  console.log("Building the local database from the migrations...");
  const reset = spawnSync("npx", ["supabase", "db", "reset", "--local"], { cwd: root, encoding: "utf8" });
  if (reset.status !== 0) {
    console.error(`The local rebuild failed:\n${scrub(reset.stderr || reset.stdout || "").trim()}`);
    process.exit(2);
  }
}
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: root, encoding: "utf8" });
const local = status.split("\n").find((l) => l.startsWith("DB_URL="))?.slice(7).replace(/^"|"$/g, "");
if (!local) {
  console.error("The local stack isn't running (npx supabase start).");
  process.exit(2);
}

const fromMigrations = readCatalog(local, "local");
const onHosted = readCatalog(hosted, "hosted", { PGOPTIONS: "-c default_transaction_read_only=on" });
const onlyLocal = [...fromMigrations].filter((l) => !onHosted.has(l)).sort();
const onlyHosted = [...onHosted].filter((l) => !fromMigrations.has(l)).sort();

console.log(`Compared ${fromMigrations.size} catalogue entries (local, from the migrations) with ${onHosted.size} (hosted).`);
if (!onlyLocal.length && !onlyHosted.length) {
  console.log("No differences: hosted is exactly what the migrations build.");
  process.exit(0);
}
const show = (title, lines) => {
  if (!lines.length) return;
  console.log(`\n${title} (${lines.length}):`);
  for (const l of lines) console.log(`  ${l.length > 300 ? `${l.slice(0, 300)}…` : l}`);
};
show("Only in the migrations (missing on hosted)", onlyLocal);
show("Only on hosted (not in any migration)", onlyHosted);
process.exit(1);
