// The runtime row-limit check in the app tests (_rowLimitCheck.mts, loaded
// with `tsx --import`): a read that asks for no limit and comes back with
// exactly the API's 1,000 rows fails; pages asked for on purpose don't.
// Run: npx tsx --import ./supabase/tests/app/_rowLimitCheck.mts supabase/tests/app/row-limit-check.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { allRows } from "@repo/types";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const topic = `Row limit ${run}`;

try {
  psql(`insert into public.guide_ai_drafts (topic, model, cost_usd) select '${topic} ' || g, 'test-model', 0.01 from generate_series(1, 1050) g;`);
  const like = `${topic} %`;

  const cut = await db.from("guide_ai_drafts").select("id").like("topic", like);
  check(!!cut.error && cut.error.message.includes("A read of guide_ai_drafts returned exactly 1000 rows without asking for a limit"),
    `1. an unbounded read of 1,050 rows fails, naming the table (${cut.error ? "failed" : `returned ${cut.data?.length} rows`})`);
  const limited = await db.from("guide_ai_drafts").select("id").like("topic", like).limit(1000);
  check(!limited.error && limited.data?.length === 1000, "2. the same read with .limit(1000) is asked for, so it passes");
  const all = await allRows((from, to) => db.from("guide_ai_drafts").select("id").like("topic", like).order("id").range(from, to), 5000);
  check(all.length === 1050, "3. allRows() reads all 1,050, a page at a time, without tripping it");
  const counted = await db.from("guide_ai_drafts").select("id", { count: "exact", head: true }).like("topic", like);
  check(!counted.error && counted.count === 1050, "4. a count-only read passes");
  const fewer = await db.from("guide_ai_drafts").select("id").like("topic", `${topic} 1%`);
  check(!fewer.error && (fewer.data?.length ?? 0) < 1000, "5. an unbounded read of fewer rows passes");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  psql(`delete from public.guide_ai_drafts where topic like '${topic} %';`);
}
console.log(failures ? `${failures} failed` : "All row-limit check checks passed.");
process.exit(failures ? 1 : 0);
