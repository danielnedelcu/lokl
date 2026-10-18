#!/usr/bin/env node
// npm run check:outside-hosts (also run by npm run build:check after each
// build): fails if a built app contains an analytics or tag-manager host,
// which would mean a tracker had been installed (decided 2026-10-17: no
// analytics; adding them is a deliberate change, privacy policy first).
//
// Icons and fonts aren't searched for here: the icon libraries keep
// Iconify's API address as a default setting even when it's switched off
// (packages/ui/nuxt.config.ts: icon.provider "none", fallbackToApi false),
// so its presence proves nothing. E2e journey 33 checks what pages really
// request: nothing outside the app and lokl's Supabase project, and every
// icon drawn from the bundle.
//
//   node scripts/check-outside-hosts.mjs           both apps
//   node scripts/check-outside-hosts.mjs website   one app

import fs from "node:fs";
import path from "node:path";

const BLOCKED = [
  { host: "googletagmanager.com", why: "Google's tag manager" },
  { host: "google-analytics.com", why: "Google Analytics" },
  { host: "analytics.google.com", why: "Google Analytics" },
  { host: "connect.facebook.net", why: "Meta's pixel" },
  { host: "plausible.io", why: "Plausible analytics" },
  { host: "posthog.com", why: "PostHog analytics" },
  { host: "cdn.segment.com", why: "Segment" },
  { host: "static.hotjar.com", why: "Hotjar" },
  { host: "va.vercel-scripts.com", why: "Vercel Analytics" },
];

const root = new URL("..", import.meta.url).pathname;
const apps = process.argv.slice(2).length ? process.argv.slice(2) : ["website", "admin"];
const problems = [];
let files = 0;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(m?js|css|html|json)$/.test(entry.name)) out.push(p);
  }
  return out;
}

for (const app of apps) {
  const output = path.join(root, "apps", app, ".output-check");
  if (!fs.existsSync(output)) {
    problems.push(`${app}: no build to check (run npm run build:check first).`);
    continue;
  }
  for (const file of walk(output, [])) {
    files++;
    const text = fs.readFileSync(file, "utf8");
    for (const { host, why } of BLOCKED) {
      if (text.includes(host)) problems.push(`${path.relative(root, file)}: ${host}, ${why}.`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}: an analytics or tracking host is in the built site. The privacy policy says there are none.`);
  process.exit(1);
}
console.log(`check:outside-hosts: ${files} built files, no analytics or tracking host.`);
