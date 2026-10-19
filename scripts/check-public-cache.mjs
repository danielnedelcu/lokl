// check:public-cache (2026-10-18): every table behind a cached public route
// either raises a content version (a public_content_changed trigger, in
// migration public_content_versions) or is on the 60-second list below with
// its reason, and each route names every scope its tables belong to.
//
// For each route that uses definePublicCachedHandler, it follows:
// - the functions it calls in the website's server helpers (auto-imported
//   from server/utils, or imported), function by function, for
//   .from("table") and .rpc("function");
// - each database function, into the tables and functions its body names;
// - each table, into the tables and functions its read rule for visitors
//   names (a listing shows only while its provider is active, say).
// Reads the LOCAL database (after db:test), never the hosted one.
//
//   node scripts/check-public-cache.mjs [--list]   (--list: what each route reads)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
const server = path.join(root, "apps/website/server");

/** Tables a cached route may read without raising a version, and why. */
const SIXTY_SECONDS = {
  // Spots and open days follow the 60-second limit (decided 2026-10-18).
  bookings: "spots left: bookings happen all the time; the booking pages check spots live",
  experience_sessions: "dates and spots",
  provider_schedules: "the hours behind open days",
  provider_weekly_hours: "the hours behind open days",
  provider_date_hours: "the hours behind open days",
  provider_time_off: "the time off behind open days",
  provider_holds: "slots held while someone books",
  service_open_days: "open days",
  service_open_days_refreshed: "when open days were last worked out",
  // Never part of a visitor's answer.
  admin_members: "only admins' own view of spots (session_spots_left asks is_admin()); a visitor's answer never depends on it",
};

const fail = (msg) => { console.error(`check:public-cache: ${msg}`); process.exit(1); };

// ---- The local database --------------------------------------------------
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const dbUrl = status.split("\n").find((l) => l.startsWith("DB_URL="))?.slice(7).replace(/^"|"$/g, "") ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(dbUrl)) fail("needs the local stack (npx supabase start), and only reads that.");
const sql = (q) => execFileSync("psql", [dbUrl, "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((l) => l.split("\t"));

const tables = new Set(sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')`).map(([t]) => t));
const functions = new Map(sql(`select p.proname, regexp_replace(string_agg(p.prosrc, ' '), '[[:space:]]+', ' ', 'g') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' group by 1`).map(([n, src]) => [n, src]));
const readRules = new Map();
for (const [t, qual] of sql(`select tablename, regexp_replace(coalesce(qual, ''), '[[:space:]]+', ' ', 'g') from pg_policies
  where schemaname = 'public' and cmd in ('SELECT', 'ALL') and ('anon' = any(roles) or 'public' = any(roles))`)) {
  readRules.set(t, `${readRules.get(t) ?? ""} ${qual}`);
}
// A table raises its scope only with both triggers: after a write, and after a truncate.
const scopeOf = new Map(sql(`select c.relname, min(split_part(encode(t.tgargs, 'escape'), '\\000', 1)) from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid where p.proname = 'public_content_changed'
  group by c.relname
  having count(*) filter (where t.tgname = c.relname || '_public_content') = 1
     and count(*) filter (where t.tgname = c.relname || '_public_content_truncate') = 1
     and count(distinct split_part(encode(t.tgargs, 'escape'), '\\000', 1)) = 1`));

const names = (text, set) => [...set].filter((n) => new RegExp(`\\b${n}\\b`).test(text));

/** Tables behind a function or a table, through bodies and visitors' read rules. */
function expand(start) {
  const seenTables = new Set();
  const seenFns = new Set();
  const queue = [...start];
  while (queue.length) {
    const item = queue.pop();
    if (item.kind === "fn") {
      if (seenFns.has(item.name)) continue;
      seenFns.add(item.name);
      const src = functions.get(item.name);
      if (src === undefined) fail(`a cached route calls ${item.name}(), which isn't a function in public.`);
      for (const t of names(src, tables)) queue.push({ kind: "table", name: t });
      for (const f of names(src, functions.keys())) if (f !== item.name) queue.push({ kind: "fn", name: f });
    } else {
      if (seenTables.has(item.name)) continue;
      seenTables.add(item.name);
      const rule = readRules.get(item.name) ?? "";
      for (const t of names(rule, tables)) queue.push({ kind: "table", name: t });
      for (const f of names(rule, functions.keys())) queue.push({ kind: "fn", name: f });
    }
  }
  return seenTables;
}

// ---- The website's code --------------------------------------------------
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []);
const utilFiles = walk(path.join(server, "utils"));

/**
 * Top-level functions in a file, by name: `function name(…) {…}` and
 * `const name = (…) => {…}`, bodies found by matching braces outside
 * strings, template text and comments, from the brace that ends the
 * signature's line.
 */
function functionsIn(src) {
  const found = new Map();
  for (const m of src.matchAll(/^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+) = (?:async )?(?:\([^)]*\)|\w+)(?:: [^=]+)? =>/gm)) {
    const name = m[1] ?? m[2];
    // The body's brace ends its line (a return type's braces don't).
    const open = src.indexOf("{\n", m.index + m[0].length);
    if (open < 0) continue;
    found.set(name, src.slice(m.index, closing(src, open) + 1));
  }
  return found;
}
function closing(src, open) {
  let depth = 0;
  const templates = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return src.length; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; continue; }
    if (c === "`") {
      for (i++; i < src.length && src[i] !== "`"; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "$" && src[i + 1] === "{") { templates.push(depth); depth++; i++; break; }
      }
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (templates.length && depth === templates[templates.length - 1]) {
        templates.pop();
        // Back inside the template text: skip to its end or next ${.
        for (i++; i < src.length && src[i] !== "`"; i++) {
          if (src[i] === "\\") i++;
          else if (src[i] === "$" && src[i + 1] === "{") { templates.push(depth); depth++; i++; break; }
        }
        continue;
      }
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

/** Top-level constants in a file (select lists, mostly), by name: their text, to the next top-level line. */
function constantsIn(src) {
  const found = new Map();
  for (const m of src.matchAll(/^(?:export )?const (\w+) = /gm)) {
    const next = src.slice(m.index + m[0].length).search(/\n\S/);
    found.set(m[1], src.slice(m.index, next < 0 ? src.length : m.index + m[0].length + next));
  }
  return found;
}

const defs = new Map(); // name -> [{ file, body }]
const fileFns = new Map();
const fileConsts = new Map();
const constDefs = new Map();
const allFiles = [...utilFiles];
for (const f of allFiles) {
  const src = fs.readFileSync(f, "utf8");
  const fns = functionsIn(src);
  fileFns.set(f, fns);
  // A constant named in a function counts as that function's code.
  const consts = new Map([...constantsIn(src)].filter(([name]) => !fns.has(name)));
  fileConsts.set(f, consts);
  for (const [name, body] of consts) constDefs.set(name, [...(constDefs.get(name) ?? []), { file: f, body }]);
  for (const [name, body] of fns) defs.set(name, [...(defs.get(name) ?? []), { file: f, body }]);
}

/** The code behind a route: its own file, then each helper function it calls, function by function. */
function codeBodies(entry) {
  const bodies = [];
  const seen = new Set();
  const queue = [{ file: entry, body: fs.readFileSync(entry, "utf8") }];
  while (queue.length) {
    const { file, body } = queue.pop();
    bodies.push(body);
    // Functions where they're called; constants (select lists) wherever they're named.
    const refs = [
      ...[...body.matchAll(/\b(\w+)\(/g)].map((m) => ({ name: m[1], own: fileFns.get(file), all: defs })),
      ...[...body.matchAll(/\b(\w+)\b/g)].map((m) => ({ name: m[1], own: fileConsts.get(file), all: constDefs })),
    ];
    for (const ref of refs) {
      const m = [null, ref.name];
      const own = ref.own?.get(m[1]);
      const target = own !== undefined ? { file, body: own } : (ref.all.get(m[1]) ?? []).find((d) => !d.file.endsWith("publicCache.ts") && !d.file.endsWith("publicCacheStore.ts"));
      if (!target) continue;
      const key = `${target.file}#${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(target);
    }
  }
  return bodies;
}

const routes = walk(path.join(server, "api")).filter((f) => fs.readFileSync(f, "utf8").includes("definePublicCachedHandler("));
if (!routes.length) fail("found no cached public routes; has definePublicCachedHandler moved?");

const problems = [];
const report = [];
for (const route of routes) {
  const src = fs.readFileSync(route, "utf8");
  const declared = new Set((src.match(/definePublicCachedHandler\(\[([^\]]*)\]/)?.[1] ?? "").match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)) ?? []);
  const start = [];
  for (const code of codeBodies(route)) {
    for (const m of code.matchAll(/\.from\(\s*"(\w+)"/g)) if (m[1] !== "public_content_versions") start.push({ kind: "table", name: m[1] });
    for (const m of code.matchAll(/\.rpc\(\s*"(\w+)"/g)) start.push({ kind: "fn", name: m[1] });
    // Embedded reads in a select: "…, photos:listing_photos(…), providers!inner(…)".
    for (const t of tables) if (new RegExp(`[\\s,:("'\`]${t}(?:!\\w+)?\\s*\\(`).test(code) && !defs.has(t)) start.push({ kind: "table", name: t });
  }
  const behind = expand(start);
  const needed = new Set();
  const rel = path.relative(root, route);
  for (const t of [...behind].sort()) {
    if (scopeOf.has(t)) needed.add(scopeOf.get(t));
    else if (!(t in SIXTY_SECONDS)) problems.push(`${rel} reads ${t}, which raises no content version and isn't on the 60-second list (scripts/check-public-cache.mjs).`);
  }
  for (const s of needed) if (!declared.has(s)) problems.push(`${rel} shows ${s} content but doesn't name the "${s}" scope.`);
  report.push(`${rel}: names ${[...declared].join(", ")}; needs ${[...needed].sort().join(", ")}; reads ${[...behind].sort().join(" ")}`);
}
for (const t of Object.keys(SIXTY_SECONDS)) if (scopeOf.has(t)) problems.push(`${t} is on the 60-second list but raises the ${scopeOf.get(t)} version: one or the other.`);

if (problems.length) fail(`\n  ${problems.join("\n  ")}`);
if (process.argv.includes("--list")) console.log(report.join("\n"));
console.log(`check:public-cache: ${routes.length} cached routes, every table behind them raises its scope or follows the 60 seconds.`);
