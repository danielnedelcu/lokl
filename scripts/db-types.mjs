// The database types (packages/types/src/database.ts), one way for writing
// and for checking, so the two can only differ where the schema does
// (decided 2026-10-16).
//
//   node scripts/db-types.mjs           write them (npm run db:types; db:push runs it after db:test)
//   node scripts/db-types.mjs --check   fail if the committed file differs (CI, after db:test)
//
// Both generate from the LOCAL stack, which db:test has just built from the
// migrations (schema:compare proves hosted is exactly that), format the
// output with the repo's Prettier, and set the __InternalSupabase block to
// hosted's PostgREST version (POSTGREST_VERSION below), which the typed
// client uses: replaced if the generator wrote one (it would be the local
// stack's version), added if not.
//
// - The Supabase CLI must be exactly the version pinned in package.json and
//   in CI (SUPABASE_CLI_VERSION in .github/workflows/ci.yml): another
//   version can generate different types.
// - Writing (during db:push, with hosted reachable) also reads hosted's
//   real PostgREST version, from its own connections there ("PostgREST
//   14.5" in pg_stat_activity, read through TBLS_DSN in a read-only
//   transaction), and stops if it no longer matches POSTGREST_VERSION.
//   Update it here then, and regenerate. (Not hosted's type generator: it
//   writes "14.17", which isn't PostgREST's version; found 2026-10-16.)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import * as prettier from "prettier";
import { pinPostgrestVersion, statedPostgrestVersions } from "./db-types-pin.mjs";

/** Hosted's PostgREST version, as PostgREST names itself in its connections there. */
const POSTGREST_VERSION = "14.5";

const root = new URL("..", import.meta.url).pathname;
const target = `${root}packages/types/src/database.ts`;
const check = process.argv.includes("--check");
function envValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  const file = `${root}.env`;
  if (!fs.existsSync(file)) return "";
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const supabase = (...args) => execFileSync("npx", ["supabase", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

// 1. The CLI is the pinned version, in both places.
const pinned = JSON.parse(fs.readFileSync(`${root}package.json`, "utf8")).devDependencies?.supabase;
const ci = fs.readFileSync(`${root}.github/workflows/ci.yml`, "utf8").match(/SUPABASE_CLI_VERSION:\s*([\d.]+)/)?.[1];
const running = supabase("--version").trim();
if (!/^\d+\.\d+\.\d+$/.test(pinned ?? "")) fail(`package.json must pin the Supabase CLI exactly (found "${pinned}").`);
if (pinned !== ci) fail(`The Supabase CLI is ${pinned} in package.json but ${ci} in CI: make them the same.`);
if (running !== pinned) fail(`The Supabase CLI running is ${running}, not the pinned ${pinned}: run npm ci.`);

// 2. Generate from the local stack, pin the block, format.
let generated;
try {
  generated = pinPostgrestVersion(supabase("gen", "types", "typescript", "--local", "--schema", "public,private"), POSTGREST_VERSION);
} catch (e) {
  fail(e.message);
}
const options = (await prettier.resolveConfig(target)) ?? {};
const formatted = await prettier.format(generated, { ...options, filepath: target });
// Exactly one version, hosted's, whatever the CLI wrote.
const stated = statedPostgrestVersions(formatted);
if (stated.length !== 1 || stated[0] !== POSTGREST_VERSION) {
  fail(`The types state PostgREST ${stated.join(", ") || "nowhere"}, not exactly ${POSTGREST_VERSION}.`);
}

if (check) {
  const committed = fs.readFileSync(target, "utf8");
  if (committed === formatted) {
    console.log("database.ts matches the migrations.");
    process.exit(0);
  }
  const tmp = `${root}node_modules/.cache/database.generated.ts`;
  fs.mkdirSync(`${root}node_modules/.cache`, { recursive: true });
  fs.writeFileSync(tmp, formatted);
  let diff = "";
  try {
    execFileSync("git", ["diff", "--no-index", "--", target, tmp], { encoding: "utf8" });
  } catch (e) {
    diff = e.stdout ?? "";
  }
  console.error(diff.split("\n").slice(0, 80).join("\n"));
  fail("\ndatabase.ts doesn't match the migrations: run npm run db:types (after npm run db:test) and commit it.");
}

// 3. Writing: hosted's PostgREST must still be the pinned version.
if (!process.argv.includes("--offline")) {
  const dsn = envValue("TBLS_DSN");
  if (!dsn) fail("No TBLS_DSN (root .env) to read hosted's PostgREST version. Use --offline to skip this check.");
  let names = "";
  try {
    names = execFileSync("psql", [dsn, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
      "begin read only; select distinct application_name from pg_stat_activity where application_name ilike 'postgrest %'; rollback;"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // Never the connection string: only that it failed.
    fail(`Couldn't read hosted's PostgREST version (${String(e.stderr ?? "").replace(/postgres(ql)?:\/\/\S+/g, "<connection string>").trim().split("\n")[0]}).`);
  }
  const hosted = [...new Set(names.split("\n").map((l) => l.match(/^PostgREST\s+(\S+)/i)?.[1]).filter(Boolean))];
  if (hosted.length !== 1) fail(`Hosted's PostgREST version isn't clear from its connections (${hosted.join(", ") || "none found"}).`);
  if (hosted[0] !== POSTGREST_VERSION) fail(`Hosted's PostgREST is now ${hosted[0]}, not ${POSTGREST_VERSION}: update POSTGREST_VERSION in scripts/db-types.mjs.`);
}
fs.writeFileSync(target, formatted);
console.log("Wrote packages/types/src/database.ts from the local stack (built from the migrations).");
