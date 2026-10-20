// check:test-ddl (2026-10-20): the browser tests run four at a time, and
// every statement that changes the schema (create, alter, drop, comment on,
// grant, revoke) makes PostgREST reload its schema cache and reset its
// connections (the pgrst_ddl_watch event trigger). Requests in flight from
// other tests then fail with a 502 from Kong: journey 40's team list in CI
// on 2026-10-20, after a helper switched a trigger off with `alter table …
// disable trigger`. This fails on such a statement anywhere in the browser
// tests or the app tests and their helpers. To set rows a guard refuses,
// switch triggers off for the session instead (`set session_replication_role
// = replica`; the watcher, like every ordinary trigger, is off then too),
// and run what must still fire (status changes) back in `origin`.
// Temporary tables are fine: the watcher skips pg_temp.
//
//   node scripts/check-test-ddl.mjs [file or folder …]
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", "test-results", "playwright-report", ".auth"]);
const DDL = [
  /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unlogged\s+)?(?:table|trigger|event\s+trigger|function|procedure|view|materialized\s+view|schema|type|domain|index|policy|extension|rule|foreign\s+table|sequence|role|publication)\b/i,
  /\bcomment\s+on\s+\w/i,
  /\b(?:grant|revoke)\s+(?:all|select|insert|update|delete|execute|usage|truncate|references|trigger)\b[^;\n]*\b(?:on|to|from)\b/i,
];

function files(p) {
  const stat = fs.statSync(p);
  if (stat.isFile()) return [p];
  return fs.readdirSync(p).filter((n) => !SKIP.has(n)).flatMap((n) => files(path.join(p, n)))
    .filter((f) => /\.(?:m?ts|m?js)$/.test(f));
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(root, "e2e"), path.join(root, "supabase/tests/app")];
const problems = [];
let scanned = 0;
for (const file of targets.flatMap(files)) {
  scanned++;
  let inBlock = false;
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const t = line.trim();
    // Full-line comments (notes may name the statements they avoid).
    if (inBlock) { if (t.includes("*/")) inBlock = false; return; }
    if (t.startsWith("/*")) { inBlock = !t.includes("*/"); return; }
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("--")) return;
    const code = t.replace(/\s--\s.*$/, "");
    if (DDL.some((re) => re.test(code)) && !/\bcreate\s+temp(?:orary)?\s+table\b/i.test(code)) {
      problems.push(`${path.relative(root, file)}:${i + 1} ${t.slice(0, 120)}`);
    }
  });
}
if (problems.length) {
  console.error(`check:test-ddl: a schema change while tests run makes PostgREST reload and drop other tests' requests (use set session_replication_role = replica):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check:test-ddl: ${scanned} test and helper files change no schema while tests run.`);
