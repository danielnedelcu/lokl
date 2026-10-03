#!/usr/bin/env node
// Times the admin search functions against the LOCAL database (after
// `node scripts/seed-admin-load.mjs`): the database time of each call (20
// runs, median and slowest), which indexes the searches use, and the API
// round trip as a signed-in admin. Local stack only; the test admin it
// signs in as is created for the run and deleted afterwards.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? "")) {
  console.error("Refusing to run: local stack only.");
  process.exit(1);
}
const RUNS = 20;
const psql = (sql) => execFileSync("psql", [env.DB_URL, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const sample = (sql) => psql(`select ${sql}`).trim();
const providerId = sample("id from public.providers where display_name like 'Peach Tours %' limit 1");
const cityId = sample("id from public.cities where slug = 'loadville'");
const email = sample("email from public.booking_contacts where email like 'maria.lee%' limit 1").split("@")[0];
const ownerEmail = "owner150@load";

// [label, function, named arguments]
const cases = [
  ["Bookings: page 1, no filters", "admin_bookings_page", {}],
  ["Bookings: page 400 (the last)", "admin_bookings_page", { p_page: 400 }],
  ["Bookings: search a common surname (rivera)", "admin_bookings_page", { p_q: "rivera" }],
  [`Bookings: search one customer's email (${email})`, "admin_bookings_page", { p_q: email }],
  ["Bookings: search two words (peach garcia)", "admin_bookings_page", { p_q: "peach garcia" }],
  ["Bookings: search a 2-letter word (le)", "admin_bookings_page", { p_q: "le" }],
  ["Bookings: search an amount ($45.00)", "admin_bookings_page", { p_q: "$45.00" }],
  ["Bookings: status + kind + 30-day range", "admin_bookings_page", { p_status: "paid_out", p_kind: "experience", p_from: "2026-06-01", p_to: "2026-06-30" }],
  ["Bookings: one provider", "admin_bookings_page", { p_provider_id: providerId }],
  ["Bookings: sorted by amount charged", "admin_bookings_page", { p_sort: "charged" }],
  ["Bookings: a needs-attention group (holds)", "admin_bookings_page", { p_attention: "holds" }],
  ["Bookings: page 1 with the attention counts", "admin_bookings_page", { p_with_attention: true }],
  ["Experiences: page 1", "admin_listings_page", { p_kind: "experience" }],
  ["Experiences: search (sunset walk)", "admin_listings_page", { p_kind: "experience", p_q: "sunset walk" }],
  ["Services: live in Loadville", "admin_listings_page", { p_kind: "service", p_status: "live", p_city_id: cityId }],
  ["Providers: page 1", "admin_providers_page", {}],
  [`Providers: search an owner's email (${ownerEmail})`, "admin_providers_page", { p_q: ownerEmail }],
  ["Providers: payouts ready, in Loadville", "admin_providers_page", { p_payout_setup: "ready", p_city_id: cityId }],
  ["Provider picker: type 'peach', 20 results", "admin_providers_page", { p_q: "peach", p_page_size: 20 }],
];

const lit = (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const call = (fn, args) => `public.${fn}(${Object.entries(args).map(([k, v]) => `${k} := ${lit(v)}`).join(", ")})`;

psql("analyze;");
const admin = sample("gen_random_uuid()");
const asAdmin = `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${admin}","role":"authenticated","app_metadata":{"role":"admin"}}', true);`;

// A timer the admin role can call: runs one function call `runs` times and
// returns its row count, total, median and slowest time (ms).
const timer = `
  create function pg_temp.bench(p_call text, p_runs int)
  returns table (row_count int, total bigint, median numeric, slowest numeric)
  language plpgsql as $f$
  declare t timestamptz; ms numeric[] := '{}'; r jsonb;
  begin
    for i in 1..p_runs loop
      t := clock_timestamp();
      execute 'select ' || p_call into r;
      ms := ms || (extract(epoch from clock_timestamp() - t) * 1000)::numeric;
    end loop;
    return query select jsonb_array_length(r -> 'rows'), (r ->> 'total')::bigint,
      round((select percentile_cont(0.5) within group (order by x) from unnest(ms) x)::numeric, 1),
      round((select max(x) from unnest(ms) x), 1);
  end $f$;`;

// 1. Database time.
console.log(`\n1. Database time (ms), ${RUNS} runs each, as an admin\n`);
console.log("| Case | Rows | Total | Median | Slowest |\n| --- | ---: | ---: | ---: | ---: |");
for (const [label, fn, args] of cases) {
  const out = psql(`begin; ${timer} ${asAdmin} select * from pg_temp.bench(${lit(call(fn, args))}, ${RUNS}); rollback;`)
    .trim().split("\n").find((l) => l.includes("|"));
  const [rows, total, median, slowest] = (out ?? "").split("|");
  console.log(`| ${label} | ${rows} | ${Number(total).toLocaleString("en-US")} | ${median} | ${slowest} |`);
}

// 2. Which indexes the searches use: auto_explain isn't allowed on
// Supabase's Postgres, so compare the per-index and per-table scan counters
// before and after one call of each search.
const counters = `select 'I ' || indexrelname || ' ' || idx_scan from pg_stat_user_indexes where schemaname = 'public'
  union all select 'T ' || relname || ' ' || seq_scan from pg_stat_user_tables where schemaname = 'public';`;
console.log("\n2. Indexes and full-table scans used by one call of each search\n");
for (const i of [2, 3, 5, 13, 16]) {
  const [label, fn, args] = cases[i];
  const script = `${counters}
    select '---';
    begin; ${asAdmin} select ${call(fn, args)} is not null; commit;
    select pg_stat_force_next_flush(); select 1; select '---';
    ${counters}`;
  const out = execFileSync("psql", [env.DB_URL, "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: script, encoding: "utf8" });
  const [before, , after] = out.split("---\n");
  const read = (block) => new Map(block.trim().split("\n").filter((l) => /^[IT] /.test(l)).map((l) => { const [k, n, c] = l.split(" "); return [`${k} ${n}`, Number(c)]; }));
  const b = read(before), a = read(after);
  const used = [...a].filter(([k, n]) => n > (b.get(k) ?? 0)).map(([k, n]) => `${k.startsWith("I") ? "index" : "full scan of"} ${k.slice(2)}${n - (b.get(k) ?? 0) > 1 ? ` (x${n - (b.get(k) ?? 0)})` : ""}`);
  console.log(`- ${label}: ${used.join(", ")}`);
}

// 3. The API round trip, as a signed-in admin (a test login made for this run).
console.log(`\n3. API round trip (ms), ${RUNS} runs each, as a signed-in admin\n`);
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const password = randomBytes(18).toString("base64url");
const adminEmail = `bench-admin-${randomBytes(3).toString("hex")}@test.local`;
const { data: made, error: makeError } = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true, app_metadata: { role: "admin" } });
if (makeError) throw makeError;
try {
  const client = createClient(env.API_URL, env.PUBLISHABLE_KEY || env.ANON_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email: adminEmail, password });
  if (signInError) throw signInError;
  console.log("| Case | Median | Slowest |\n| --- | ---: | ---: |");
  for (const [label, fn, args] of cases) {
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      const { error } = await client.rpc(fn, args);
      if (error) throw new Error(`${label}: ${error.message}`);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`| ${label} | ${((times[9] + times[10]) / 2).toFixed(1)} | ${times[RUNS - 1].toFixed(1)} |`);
  }
} finally {
  await service.auth.admin.deleteUser(made.user.id);
}
