// Checks that the apps build, without disturbing running dev servers: each
// build goes to its own folders (.nuxt-check, .output-check, a separate Vite
// cache; see buildCheckFolders in each nuxt.config.ts), never the .nuxt the
// dev server reads.
//
//   npm run build:check            both apps
//   npm run build:check -- website one app
//
// LOKL_BUILD_SET=secrets (build:secrets-check) builds into folders of its
// own (.nuxt-secrets, .output-secrets), so the check build the tests run is
// never replaced by the one with sentinel secrets.
import { spawnSync } from "node:child_process";

const set = process.env.LOKL_BUILD_SET === "secrets" ? "secrets" : "check";
const apps = process.argv.slice(2).length ? process.argv.slice(2) : ["website", "admin"];
let failed = false;
for (const app of apps) {
  console.log(`Building ${app} (${set} folders)...`);
  const r = spawnSync("npx", ["nuxt", "build"], {
    cwd: new URL(`../apps/${app}/`, import.meta.url),
    env: { ...process.env, LOKL_BUILD_CHECK: set === "secrets" ? "secrets" : "1", LOKL_ALLOW_PLACEHOLDERS: "1" },
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.status === 0) console.log(`${app}: builds`);
  else {
    failed = true;
    console.error(`${app}: build failed\n${r.stderr.split("\n").filter((l) => /error/i.test(l)).slice(0, 20).join("\n")}`);
  }
}
// What was built mustn't contain an analytics or tracking host the privacy policy doesn't name.
if (!failed) {
  const r = spawnSync(process.execPath, [new URL("check-outside-hosts.mjs", import.meta.url).pathname, ...apps], { stdio: "inherit", env: { ...process.env, LOKL_BUILD_SET: set } });
  if (r.status !== 0) failed = true;
}
// Text marked to be replaced before launch is allowed in these test builds,
// and listed; any other build fails on it (scripts/launch-placeholders.mjs).
if (!failed) {
  const { findLaunchPlaceholders, describeLaunchPlaceholders } = await import("./launch-placeholders.mjs");
  const found = apps.flatMap((app) => findLaunchPlaceholders(new URL(`../apps/${app}/.output-${set}/`, import.meta.url).pathname));
  if (found.length) console.log(`Still to replace before launch (a deployable build would fail):\n  ${describeLaunchPlaceholders(found).join("\n  ")}`);
}
process.exit(failed ? 1 : 0);
