#!/usr/bin/env node
// Text that marks something unfinished, which must never reach a build that
// could be deployed (decided 2026-10-18). Every placeholder carries the fixed
// marker LAUNCH-PLACEHOLDER beside its visible wording, and the marker is
// what's searched for, so rewording a placeholder can't make the check miss
// it (packages/ui/tests/info-pages.test.mts fails on placeholder wording
// without the marker). Every `nuxt build` of either app
// searches its own output and fails if one is there (the hook in
// packages/ui/nuxt.config.ts), except the repo's test builds (npm run
// build:check, which sets LOKL_ALLOW_PLACEHOLDERS=1; the e2e tests and CI run it), which
// list what's left instead. A deploy can't skip it by leaving out a setting.
//
// The legal drafts' placeholders ("[lokl's legal name]", "[address]") carry
// the marker too when they're written (step 4).
//
//   node scripts/launch-placeholders.mjs <folder>...   list them; exit 1 if any

import fs from "node:fs";
import path from "node:path";

/** The marker every placeholder carries (e.g. the About page's "Why lokl exists"). */
export const LAUNCH_MARKER = "LAUNCH-PLACEHOLDER";

/** Every file in a built app's folder holding the marker: [{ placeholder, file }]. */
export function findLaunchPlaceholders(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(m?js|html|json|md|txt)$/.test(entry.name)) {
        const text = fs.readFileSync(p, "utf8");
        if (text.includes(LAUNCH_MARKER)) found.push({ placeholder: LAUNCH_MARKER, file: p });
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

/** The found placeholders as lines, one per placeholder, with how many files hold it. */
export function describeLaunchPlaceholders(found, base = process.cwd()) {
  const by = new Map();
  for (const f of found) by.set(f.placeholder, [...(by.get(f.placeholder) ?? []), path.relative(base, f.file)]);
  return [...by].map(([placeholder, files]) => `"${placeholder}" in ${files.length} file${files.length === 1 ? "" : "s"} (${files[0]}${files.length > 1 ? ", …" : ""})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error("Usage: node scripts/launch-placeholders.mjs <folder>...");
    process.exit(2);
  }
  const found = dirs.flatMap((d) => findLaunchPlaceholders(d));
  for (const line of describeLaunchPlaceholders(found)) console.log(line);
  process.exit(found.length ? 1 : 0);
}
