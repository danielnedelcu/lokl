#!/usr/bin/env node
// npm run check:reads: reads that could stop at the API's row limit without
// saying so (docs/TODO.md, Hardening; the truncation sweep, 2026-10-10).
//
// The API returns at most 1,000 rows per request (max_rows), with no error.
// This scans every Supabase read in both apps and the shared packages and
// fails when a read of a table that grows has nothing bounding it:
//
//   .range(...), .limit(n), .single(), .maybeSingle(), a count-only read
//   (head: true), a filter on the row's id, or allRows(...) around it.
//
// A read that's bounded another way (one parent's photos, at most 8) says
// why with a `// bounded: <reason>` comment on the line above or the same
// line. It also fails on .limit() above 1,000 or not a plain number (the
// API would cut it to 1,000 anyway), and on a table in database.ts that
// isn't classified below, so every new table gets a decision.
//
// Static and approximate: a query built over several statements is checked
// at its first one, so it needs the comment. The runtime check
// (rowLimitFetch) catches what this can't.

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const API_MAX_ROWS = 1000;

// Tables an admin keeps short by hand. Every other table grows.
// admin_members: one row per team member (docs/design/admin-roles.md), a handful.
// admin_settings: one row (admin roles, step 5b).
const REFERENCE = new Set(["cities", "categories", "service_areas", "commission_rates", "homepage_features", "admin_members", "public_content_versions", "admin_settings",
  // The job scheduler (2026-10-21): one row per scheduled job, and at most one lease each.
  "job_status", "job_leases"]);
const GROWS = new Set([
  "admin_actions", "booking_addresses", "booking_contacts", "booking_emails", "booking_events", "booking_finances",
  "booking_reports", "bookings", "commission_rate_changes", "experience_sessions", "guide_ai_drafts", "guide_photos",
  "guide_versions", "guides", "job_runs", "job_alerts", "stripe_attempts", "listing_addresses", "listing_photos", "listing_ratings",
  "listing_service_areas", "listings", "notifications", "provider_emails", "provider_ratings", "providers",
  "review_replies", "review_reports", "reviews", "saved_listings", "saved_providers",
  // Service availability (2026-10-14): per provider, and holds per booking or session.
  "provider_date_hours", "provider_holds", "provider_schedules", "provider_time_off", "provider_weekly_hours",
  // Search by availability (2026-10-15): open days per Service.
  "service_open_days", "service_open_days_pending", "service_open_days_refreshed",
  // Problem reports (2026-10-17).
  "admin_emails", "admin_notifications", "support_emails",
  // Support's requests to the owner (admin roles, step 5b).
  "admin_requests",
  // Contact views and refunds in flight (admin roles, step 5c).
  "admin_contact_views", "admin_refund_holds", "provider_profile_holds", "support_messages", "support_notes", "support_report_events", "support_reports",
  // private.booking_records (bookingRecords(db)) is checked as bookings.
]);

const problems = [];

// 1. Every table in the generated types is classified.
const types = fs.readFileSync(path.join(root, "packages/types/src/database.ts"), "utf8");
const publicTables = types.slice(types.indexOf("  public: {"));
const tablesBlock = publicTables.slice(publicTables.indexOf("    Tables: {"), publicTables.indexOf("    Views: {"));
for (const m of tablesBlock.matchAll(/^ {6}([a-z_]+): \{$/gm)) {
  if (!REFERENCE.has(m[1]) && !GROWS.has(m[1])) problems.push(`database.ts: table ${m[1]} isn't classified as growing or reference in scripts/check-reads.mjs`);
}

// 2. Every read.
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".nuxt", ".output", ".nuxt-check", ".output-check", ".nuxt-secrets", ".output-secrets", "tests", "dist"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|vue|mts)$/.test(e.name) && !e.name.endsWith(".d.ts") && e.name !== "database.ts") files.push(p);
  }
};
for (const d of ["apps/website/app", "apps/website/server", "apps/admin/app", "apps/admin/server", "packages/ui/app", "packages/types/src"]) {
  if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
}

const BOUNDED = /\.(range|limit|single|maybeSingle)\(|head:\s*true|\.eq\(\s*"id"/;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const m of src.matchAll(/(?<!storage)\.from\(\s*"([a-z_]+)"\s*\)|bookingRecords\([^)]*\)/g)) {
    const table = m[1] ?? "bookings";
    const start = m.index;
    // The read ends at its statement's end, or where the next query starts
    // (reads side by side in one Promise.all are separate).
    const end = (() => {
      const semi = src.indexOf(";", start);
      const rest = src.slice(start + 1);
      const next = rest.search(/\.from\(\s*"|\.rpc\(\s*"|bookingRecords\(/);
      return Math.min(semi < 0 ? src.length : semi, next < 0 ? src.length : start + 1 + next);
    })();
    const chain = src.slice(start, end);
    if (!/\.select\(/.test(chain)) continue;
    // A write returning its own changed rows is bounded by the write.
    const beforeSelect = chain.slice(0, chain.indexOf(".select("));
    if (/\.(insert|update|upsert|delete)\(/.test(beforeSelect)) continue;
    const line = src.slice(0, start).split("\n").length;
    const lines = src.split("\n");
    const here = `${rel}:${line}`;
    for (const lm of chain.matchAll(/\.limit\(([^)]*)\)/g)) {
      const n = Number(lm[1].trim());
      if (!Number.isFinite(n) && !/^[A-Z_]+$|^o\.limit \?\? \d+$/.test(lm[1].trim())) problems.push(`${here}: .limit(${lm[1]}) isn't a plain number or a named constant`);
      else if (n > API_MAX_ROWS) problems.push(`${here}: .limit(${n}) is above the API's ${API_MAX_ROWS} rows, which it cuts to without saying`);
    }
    if (REFERENCE.has(table)) continue;
    if (!GROWS.has(table)) { problems.push(`${here}: table ${table} isn't classified in scripts/check-reads.mjs`); continue; }
    if (BOUNDED.test(chain)) continue;
    // allRows(...) wrapping this read.
    const before = src.slice(Math.max(0, start - 200), start);
    if (/allRows\([^;]*$/.test(before)) continue;
    // An explained bound.
    const comment = [lines[line - 1], lines[line - 2], lines[line - 3]].join("\n");
    if (/\/\/ bounded: \S/.test(comment)) continue;
    problems.push(`${here}: reads ${table} with nothing bounding it (add .range() or .limit(), page it, use allRows(), or say why with // bounded: <reason>)`);
  }
}

if (problems.length) {
  console.error(`check:reads found ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`check:reads: ${files.length} files, every read of a growing table is bounded.`);
