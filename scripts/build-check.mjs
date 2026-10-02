// Checks that the apps build, without disturbing running dev servers: each
// build goes to its own folders (.nuxt-check, .output-check, a separate Vite
// cache; see buildCheckFolders in each nuxt.config.ts), never the .nuxt the
// dev server reads.
//
//   npm run build:check            both apps
//   npm run build:check -- website one app
import { spawnSync } from "node:child_process";

const apps = process.argv.slice(2).length ? process.argv.slice(2) : ["website", "admin"];
let failed = false;
for (const app of apps) {
  console.log(`Building ${app} (check folders)...`);
  const r = spawnSync("npx", ["nuxt", "build"], {
    cwd: new URL(`../apps/${app}/`, import.meta.url),
    env: { ...process.env, LOKL_BUILD_CHECK: "1" },
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.status === 0) console.log(`${app}: builds`);
  else {
    failed = true;
    console.error(`${app}: build failed\n${r.stderr.split("\n").filter((l) => /error/i.test(l)).slice(0, 20).join("\n")}`);
  }
}
process.exit(failed ? 1 : 0);
