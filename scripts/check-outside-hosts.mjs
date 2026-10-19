#!/usr/bin/env node
// npm run check:outside-hosts (also run by npm run build:check after each
// build): fails if a built app contains an analytics or tracking host it
// shouldn't (decided 2026-10-17: Google Analytics 4 on the website only,
// for measurement; anything more is a deliberate change, privacy policy
// first).
//
// - The website may contain exactly Google's tag script address
//   (https://www.googletagmanager.com/gtag/js, nuxt-gtag's loader), and
//   nothing else on this list.
// - The admin app may contain none of them.
//
// Icons and fonts aren't searched for here: the icon libraries keep
// Iconify's API address as a default setting even when it's switched off
// (packages/ui/nuxt.config.ts: icon.provider "none", fallbackToApi false),
// so its presence proves nothing. E2e journey 33 checks what pages really
// request, and journey 35 what Google Analytics is sent.
//
//   node scripts/check-outside-hosts.mjs           both apps
//   node scripts/check-outside-hosts.mjs website   one app

import fs from "node:fs";
import path from "node:path";

const BLOCKED = [
  { host: "googletagmanager.com", why: "Google's tag manager (the website may load only its tag script, /gtag/js)" },
  { host: "google-analytics.com", why: "Google Analytics" },
  { host: "analytics.google.com", why: "Google Analytics" },
  { host: "connect.facebook.net", why: "Meta's pixel" },
  { host: "plausible.io", why: "Plausible analytics" },
  { host: "posthog.com", why: "PostHog analytics" },
  { host: "cdn.segment.com", why: "Segment" },
  { host: "static.hotjar.com", why: "Hotjar" },
  { host: "va.vercel-scripts.com", why: "Vercel Analytics" },
];

/** What each app may contain, taken out before searching (the website's Google tag loader). */
const ALLOWED = { website: ["https://www.googletagmanager.com/gtag/js"], admin: [] };

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
  // The check build, or build:secrets-check's own (LOKL_BUILD_SET=secrets).
  const output = path.join(root, "apps", app, process.env.LOKL_BUILD_SET === "secrets" ? ".output-secrets" : ".output-check");
  if (!fs.existsSync(output)) {
    problems.push(`${app}: no build to check (run npm run build:check first).`);
    continue;
  }
  for (const file of walk(output, [])) {
    files++;
    let text = fs.readFileSync(file, "utf8");
    for (const ok of ALLOWED[app] ?? []) text = text.split(ok).join("");
    for (const { host, why } of BLOCKED) {
      if (text.includes(host)) problems.push(`${path.relative(root, file)}: ${host}, ${why}.`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}: an analytics or tracking host is in the built site that the privacy policy doesn't name.`);
  process.exit(1);
}
console.log(`check:outside-hosts: ${files} built files, no analytics or tracking host beyond the website's Google tag script.`);
