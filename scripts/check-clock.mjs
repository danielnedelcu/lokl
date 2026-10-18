#!/usr/bin/env node
// npm run check:clock: server code reads the clock on purpose (decided
// 2026-10-18; the fixed "now" for tests).
//
// The database's now() decides every rule that's enforced. In the servers'
// utilities, the time is either:
//   - a parameter, defaulting to the real time (`now = Date.now()`,
//     `opts.now ?? new Date()`), so a test can pass a fixed one and a route
//     passes nothing (the real time); or
//   - the real time on purpose, said with a `// real time: <reason>`
//     comment on its line or the line above: a record of when something
//     happened, Stripe's real clock (idempotency windows, Checkout expiry),
//     or a rule the server checks as well as the database.
//
// This fails on any other Date.now() or new Date() with no argument in
// apps/website/server/utils and apps/admin/server/utils. Static and
// approximate, like check:dates and check:reads.

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const DIRS = ["apps/website/server/utils", "apps/admin/server/utils"];
const READ = /\bDate\.now\(\)|\bnew Date\(\)/g;
// A parameter's default: `now = Date.now()`, `now = new Date()`, or `x.now ?? new Date()`.
// (In a signature only, after "(" or ",": a local `const now = new Date()` isn't one.)
const PARAMETER = /[(,]\s*now(?:\s*:\s*[\w| ]+?)?\s*=\s*(?:Date\.now\(\)|new Date\(\))|\.now\s*\?\?\s*(?:Date\.now\(\)|new Date\(\))/g;
const REASON = /\/\/ real time: \S/;

const problems = [];
let reads = 0;
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|mts|js|mjs)$/.test(entry.name)) check(p);
  }
}
function check(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    const all = code.match(READ)?.length ?? 0;
    if (!all) return;
    reads += all;
    const asParameter = code.match(PARAMETER)?.length ?? 0;
    if (all <= asParameter) return;
    if (REASON.test(line) || REASON.test(lines[i - 1] ?? "")) return;
    problems.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
for (const d of DIRS) walk(path.join(root, d));

if (problems.length) {
  console.error("check:clock: server utilities read the clock without saying why. Take `now` as a parameter (defaulting to the real time), or add `// real time: <reason>`:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check:clock: ${reads} clock reads in the server utilities, each a parameter's default or the real time on purpose.`);
