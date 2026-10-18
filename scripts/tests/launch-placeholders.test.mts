// The launch placeholder check (scripts/launch-placeholders.mjs; decided
// 2026-10-18): it finds the fixed marker (LAUNCH-PLACEHOLDER) in a built
// app's files, whatever the placeholder's wording, and the About page
// carries it, so a deployable build fails until the founder's words
// replace it.
// Run: npx tsx scripts/tests/launch-placeholders.test.mts (part of `npm run test:ui`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error: a plain .mjs script, without types.
import { findLaunchPlaceholders, LAUNCH_MARKER } from "../launch-placeholders.mjs";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-placeholders-"));
try {
  fs.mkdirSync(path.join(dir, "public/_nuxt"), { recursive: true });
  fs.writeFileSync(path.join(dir, "public/_nuxt/clean.js"), 'const about = "Who we are";');
  check(findLaunchPlaceholders(dir).length === 0, "1. a build without the marker passes");
  fs.writeFileSync(path.join(dir, "public/_nuxt/about.js"), 'const md = "> **Our story goes here** (LAUNCH-PLACEHOLDER): why lokl";');
  const found = findLaunchPlaceholders(dir);
  check(found.length === 1 && found[0].file.endsWith("about.js"), "2. ...and one with the marker is caught, whatever the wording, naming the file");
  fs.writeFileSync(path.join(dir, "public/_nuxt/old.js"), 'const md = "Placeholder, to be replaced before launch";');
  check(findLaunchPlaceholders(dir).length === 1, "2b. the wording alone isn't what's searched for (the marker is)");
  fs.writeFileSync(path.join(dir, "public/photo.png"), "LAUNCH-PLACEHOLDER");
  check(findLaunchPlaceholders(dir).length === 1, "3. only text files are searched (not images)");
  check(findLaunchPlaceholders(path.join(dir, "missing")).length === 0, "4. a folder that isn't there has none (the hook runs after a build)");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const about = fs.readFileSync(new URL("../../apps/website/content/pages/about.md", import.meta.url), "utf8");
check(LAUNCH_MARKER === "LAUNCH-PLACEHOLDER" && about.includes(`(${LAUNCH_MARKER})`), "5. the About page's placeholder carries the marker");

console.log(failures ? `${failures} failed` : "All launch placeholder checks passed.");
process.exit(failures ? 1 : 0);
