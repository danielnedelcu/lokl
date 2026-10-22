// The search reads (SEARCH_READS in packages/types/src/retryReads.ts): POSTs
// that retryReadsFetch asks again after a gateway error (decided 2026-10-21).
// Asking a function twice is only safe if it writes nothing, so for each name
// on the list this checks, against the local database built from the
// migrations:
// - it's `stable` or `immutable` (Postgres refuses writes in those);
// - it takes search text (a `p_q` text argument), else it belongs on GET;
// - called as an admin inside a read-only transaction, it runs without error
//   (a write anywhere, even in a volatile function it calls, fails there);
// - the apps call it with POST, never `{ get: true }` (else the list isn't needed).
// Run: npx tsx supabase/tests/app/search-reads.test.mts (needs the local stack).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SEARCH_READS } from "@repo/types";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(local.DB_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
/** Runs a psql script; a failure is reported by its ERROR line only, never the command (it names the database). */
function psql(script: string): string {
  try {
    return execFileSync("psql", [local.DB_URL!, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw new Error(String((e as { stderr?: string }).stderr ?? "").split("\n").find((l) => l.includes("ERROR"))?.trim() ?? "psql failed");
  }
}

/** Each `rpc("name", ...)` call in the apps, from its opening to its closing parenthesis. */
function callsOf(fn: string): string[] {
  const files = execFileSync("git", ["grep", "-l", `rpc("${fn}"`, "--", "apps", "packages"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const out: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (let i = text.indexOf(`rpc("${fn}"`); i >= 0; i = text.indexOf(`rpc("${fn}"`, i + 1)) {
      let depth = 0;
      let j = i + 3;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) break;
      }
      out.push(text.slice(i, j + 1));
    }
  }
  return out;
}
/** Arguments for the read-only call, where a function needs more than the search text. */
const CALL_ARGS: Record<string, string> = {
  admin_listings_page: "p_kind => 'service', p_q => 'peach'",
};

for (const fn of SEARCH_READS as readonly string[]) {
  const row = psql(`select p.provolatile::text || '|' || coalesce((
      select t.typname from unnest(p.proargnames, p.proargtypes::oid[]) a(name, type) join pg_type t on t.oid = a.type where a.name = 'p_q'
    ), '-')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '${fn}'`);
  const [volatility, qType] = row.split("|");
  check(row.split("\n").length === 1 && !!volatility, `1. ${fn} exists, once`);
  check(volatility === "s" || volatility === "i", `2. ${fn} is stable, so it writes nothing (${volatility === "v" ? "volatile" : volatility})`);
  check(qType === "text", `3. ${fn} takes search text (p_q: ${qType})`);

  // As an admin who passed the second step, then read-only: any write fails.
  let ran = "";
  try {
    psql(`begin;
\\ir ${process.cwd()}/supabase/tests/_helpers/users.psql
select tests.authenticate_as_admin(tests.create_user('search-reads-${fn}@test.local'));
set transaction read only;
select public.${fn}(${CALL_ARGS[fn] ?? "p_q => 'peach'"}) is not null;
rollback;`);
    ran = "ok";
  } catch (e) {
    ran = (e as Error).message;
  }
  check(ran === "ok", `4. ${fn} runs as an admin in a read-only transaction${ran === "ok" ? "" : ` (${ran.trim()})`}`);

  const calls = callsOf(fn);
  check(calls.length > 0, `5a. ${fn} is called by the apps (${calls.length} place${calls.length === 1 ? "" : "s"})`);
  check(calls.every((c) => !c.includes("get: true")), `5b. ${fn} is called with POST, never { get: true }`);
}

console.log(failures ? `${failures} failed` : "All search-read checks passed.");
process.exit(failures ? 1 : 0);
