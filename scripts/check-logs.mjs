#!/usr/bin/env node
// npm run check:logs: server logs hold no contact details (decided
// 2026-10-17). A database, Resend or Stripe error can quote a row's values
// or an address, so the servers never print an error object or its
// message as it is: they print errorText(e) (or logText, stripeErrorSummary
// or logSupportError), which keeps the code and words but replaces email
// addresses, phone numbers and keys (packages/types/src/logs.ts).
//
// This fails on a console.error/warn/log/info call in server code whose
// arguments include a bare error (e, err, error, or a name ending in Err or
// Error) or an error's .message. Static and approximate, like check:reads.

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const DIRS = ["apps/website/server", "apps/admin/server", "packages/ui/server"];
const RAW = /(?:^|[(,]\s*)(?:e|err|error|\w+Err|\w+Error|[\w.]+\.message)\s*(?=[,)])/;
const problems = [];
let calls = 0;

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
    const m = line.match(/console\.(error|warn|log|info)\((.*)$/);
    if (!m) return;
    calls++;
    // The call's arguments, with the safe wrappers' own arguments taken out.
    const args = m[2].replace(/\b(errorText|logText|stripeErrorSummary|logSupportError)\([^)]*\)/g, "SAFE");
    if (RAW.test(args)) problems.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}

DIRS.forEach((d) => walk(path.join(root, d)));
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} server log${problems.length === 1 ? "" : "s"} print an error as it is. Use errorText(e) from @repo/types.`);
  process.exit(1);
}
console.log(`check:logs: ${calls} server log calls, none printing an error as it is.`);
