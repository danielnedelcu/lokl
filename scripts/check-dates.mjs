#!/usr/bin/env node
// npm run check:dates: dates and times that would follow the device's zone
// (docs/frontend.md; the time-zone guard, 2026-10-10).
//
// Every date or time lokl shows is in a named zone: a market's (marketZone)
// or the home zone, labelled. The device's zone is the visitor's in the
// browser and the server's while rendering, so a time that follows it can
// show a different day on each. This scans both apps and the shared
// packages and fails on:
//
//   - new Intl.DateTimeFormat(...), toLocaleDateString, toLocaleTimeString,
//     or a date toLocaleString, without a timeZone;
//   - local-time getters and setters (getHours, getDate, getDay, getMonth,
//     getFullYear, getMinutes, getTimezoneOffset, setHours, setDate...);
//   - new Date(y, m, ...) built from local parts;
//   - toISOString() cut down to a day;
//   - a date-only string given to new Date or Date.parse (read in UTC by
//     some engines, locally by others) instead of one ending in Z or an offset.
//
// zonedTime.ts and formatDate.ts are where zones are applied, so they're
// exempt. Anything else that's genuinely zone-free says why with a
// `// zone: <reason>` comment on its line or the line above.
// Static and approximate: formatDate and formatDateTime need a zone by
// their types, which typecheck enforces; this covers the rest.

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const EXEMPT = new Set(["packages/ui/app/utils/zonedTime.ts", "packages/ui/app/utils/formatDate.ts"]);
const problems = [];

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".nuxt", ".output", ".nuxt-check", ".output-check", "tests", "dist"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|vue|mts)$/.test(e.name) && !e.name.endsWith(".d.ts") && e.name !== "database.ts") files.push(p);
  }
};
for (const d of ["apps/website/app", "apps/website/server", "apps/admin/app", "apps/admin/server", "packages/ui/app", "packages/types/src"]) {
  if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
}

/** The text of a call's arguments, from the "(" at `open` to its matching ")". */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}
/** The arguments split at top-level commas. */
function topLevelArgs(args) {
  const out = [];
  let depth = 0, start = 0, quote = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) { if (c === quote && args[i - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(args.slice(start, i)); start = i + 1; }
  }
  if (args.slice(start).trim()) out.push(args.slice(start));
  return out;
}

for (const file of files) {
  const rel = path.relative(root, file);
  if (EXEMPT.has(rel)) continue;
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const explained = (line) => /\/\/ zone: \S/.test(`${lines[line - 1] ?? ""}\n${lines[line - 2] ?? ""}`);
  const flag = (i, what) => {
    const line = lineOf(i);
    if (!explained(line)) problems.push(`${rel}:${line}: ${what}`);
  };

  // Formatters without a timeZone.
  for (const m of src.matchAll(/new Intl\.DateTimeFormat\(|\.toLocaleDateString\(|\.toLocaleTimeString\(|\.toLocaleString\(/g)) {
    const args = argsAt(src, m.index + m[0].length - 1);
    const isDateFormatter = !m[0].includes("toLocaleString") || /\b(year|month|day|weekday|hour|minute|dateStyle|timeStyle)\s*:/.test(args);
    if (isDateFormatter && !/\btimeZone\b/.test(args)) flag(m.index, `${m[0].replace(/^\.|\($/g, "")} without a timeZone (use the market's zone or the home zone)`);
  }
  // Local-time getters and setters.
  for (const m of src.matchAll(/\.(get|set)(Hours|Minutes|Seconds|Date|Day|Month|FullYear|TimezoneOffset)\(/g)) {
    flag(m.index, `${m[0].slice(1, -1)}() follows the device's zone (use instantToZoned or a getUTC method)`);
  }
  // new Date(y, m, ...) from local parts.
  for (const m of src.matchAll(/new Date\(/g)) {
    const args = topLevelArgs(argsAt(src, m.index + m[0].length - 1));
    if (args.length >= 2) flag(m.index, "new Date(y, m, ...) is built in the device's zone (use zonedToInstant)");
    // A date-only string: a literal "YYYY-MM-DD", or a template with no time, Z or offset.
    if (args.length === 1) {
      const a = args[0].trim();
      if (/^["'`]\d{4}-\d{2}-\d{2}["'`]$/.test(a)) flag(m.index, `new Date(${a}) is a date-only string (say the time and Z, or use zonedToInstant)`);
      else if (/^`.*`$/s.test(a) && !/(Z|[+-]\d{2}:?\d{2})`$/.test(a)) flag(m.index, `new Date(${a.slice(0, 40)}) is a string without Z or an offset`);
    }
  }
  for (const m of src.matchAll(/Date\.parse\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*\)/g)) {
    if (!/(Z|[+-]\d{2}:?\d{2})["'`]$/.test(m[1])) flag(m.index, `Date.parse(${m[1].slice(0, 40)}) is a string without Z or an offset`);
  }
  // toISOString() cut down to a day.
  for (const m of src.matchAll(/toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(\s*["']T["']\s*\))/g)) {
    flag(m.index, "toISOString() cut to a day is the UTC day (use todayIn or instantToZoned)");
  }
}

if (problems.length) {
  console.error(`check:dates found ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`check:dates: ${files.length} files, every date and time names its zone.`);
