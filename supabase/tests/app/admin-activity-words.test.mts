// The words the apps keep for the database's lists (admin roles step 5d),
// read from the LOCAL stack's own definitions, so every branch is covered
// without fixtures:
// - every readiness item listing_readiness_of() can return has a key the
//   apps know and the admin's wording for it (REVIEW_BLOCKER_LABELS), and
//   no key is kept that the database never returns;
// - every action admin_actions may log (admin_actions_action_check) has a
//   phrase for the Activity page and History (ADMIN_ACTION_LABELS), and
//   none is kept that it can't log.
// Run: npx tsx supabase/tests/app/admin-activity-words.test.mts

import { execFileSync } from "node:child_process";
import { ADMIN_ACTION_LABELS, READINESS_KEYS, REVIEW_BLOCKER_LABELS } from "@repo/types";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const dbUrl = local.DB_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(dbUrl)) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const sql = (text: string) => execFileSync("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8" }).trim();

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const missing = (from: string[], in_: readonly string[]) => from.filter((x) => !in_.includes(x));

// The items: each row of the function's values list starts "(n, 'key', ".
const source = sql("select pg_get_functiondef('public.listing_readiness_of(public.listings)'::regprocedure)");
const keys = [...new Set([...source.matchAll(/\(\s*\d+\s*,\s*'([a-z_]+)'\s*,/g)].map((m) => m[1]!))];
check(keys.length >= 6, `1a. the database's readiness items are found (${keys.join(", ")})`);
check(missing(keys, READINESS_KEYS).length === 0, `1b. every one is a key the apps know (unknown: ${missing(keys, READINESS_KEYS).join(", ") || "none"})`);
check(keys.every((k) => (REVIEW_BLOCKER_LABELS as Record<string, string>)[k]?.trim()), "1c. ...and has the admin's wording");
check(sameSet(keys, [...READINESS_KEYS]), `1d. no key is kept that the database never returns (extra: ${missing([...READINESS_KEYS], keys).join(", ") || "none"})`);

// The actions: the check constraint's list.
const def = sql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'admin_actions_action_check'");
const actions = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
const labels = Object.keys(ADMIN_ACTION_LABELS);
check(actions.length >= 40, `2a. the actions the log may hold are found (${actions.length})`);
check(missing(actions, labels).length === 0, `2b. every one has a phrase (missing: ${missing(actions, labels).join(", ") || "none"})`);
check(missing(labels, actions).length === 0, `2c. no phrase for an action it can't hold (extra: ${missing(labels, actions).join(", ") || "none"})`);

console.log(failures ? `${failures} failed` : "All admin activity word checks passed.");
process.exit(failures ? 1 : 0);
