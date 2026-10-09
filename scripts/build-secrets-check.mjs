// npm run build:secrets-check: no secret reaches a build (docs/TODO.md; a
// practice from The Reserve, 2026-10-09).
//
// Builds both apps (the check folders, like build:check) with a unique
// sentinel value for every private setting, then fails if any sentinel is
// anywhere in the build output. A build made without secrets proves nothing,
// so every private name gets one: each non-public name in the .env.example
// files, the Supabase module's older names for the server key, and the OG
// image secret. Values already in the environment win over .env files, so
// no real secret is used.
//
// Found 2026-10-09: the Supabase module's defaults and nuxt-og-image read
// the server key and the OG secret from the environment while building and
// baked them in (fixed in each nuxt.config.ts).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const examples = ["apps/website/.env.example", "apps/admin/.env.example", ".env.example"];
// Read by modules rather than our runtimeConfig, so not in .env.example.
const moduleNames = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "NUXT_SUPABASE_SERVICE_KEY", "NUXT_OG_IMAGE_SECRET"];

const names = new Set(moduleNames);
for (const file of examples) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (m && !m[1].startsWith("NUXT_PUBLIC_")) names.add(m[1]);
  }
}
const run = randomBytes(6).toString("hex");
const sentinels = Object.fromEntries([...names].sort().map((n) => [n, `lokl-sentinel-${n.toLowerCase().replace(/_/g, "-")}-${run}`]));
console.log(`Building both apps with sentinel values for ${names.size} private settings...`);
const build = spawnSync(process.execPath, ["scripts/build-check.mjs"], { cwd: root, env: { ...process.env, ...sentinels }, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const found = new Map();
let files = 0;
for (const app of ["website", "admin"]) {
  const dir = path.join(root, "apps", app, ".output-check");
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const text = fs.readFileSync(file).toString("latin1");
    files++;
    for (const [name, value] of Object.entries(sentinels)) {
      if (text.includes(value)) found.set(name, [...(found.get(name) ?? []), path.relative(root, file)]);
    }
  }
}
console.log(`Scanned ${files} files in both apps' build output.`);
if (!found.size) {
  console.log("No secret reached the build.");
  process.exit(0);
}
for (const [name, where] of found) console.error(`Baked into the build: ${name} (in ${where.slice(0, 3).join(", ")}${where.length > 3 ? ", …" : ""})`);
process.exit(1);
