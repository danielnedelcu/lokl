// check:null-guards (2026-10-20): a refusal or a role test in a database
// function can't be skipped by a null. In SQL, `v_role = 'owner'` is null,
// not false, when v_role is null, and plpgsql's `if` treats null as false:
// `if not (v_role = 'owner') then raise` lets a null through. That let a
// customer past is_owner() (found in step 5a) and support past the
// finishing path's owner check (step 5b).
//
// For every plpgsql function in public and private, as the migrations build
// it (run after db:test), each `if`/`elsif` whose branch raises
// insufficient_privilege (42501), or whose condition tests a role (a role
// variable or column, admin_role(), admin_role_of(), is_owner(),
// is_admin(), auth.role()), must be null-safe. Each part of the condition
// (split on top-level and/or) must be one of:
// - `x is [not] null`, `is [not] true/false`, `is [not] distinct from`;
// - `[not] exists (...)`, or a `coalesce(...)` comparison;
// - a call to a helper that never returns null (NEVER_NULL, each tested
//   in null_guards.test.sql), alone or with `not`;
// - a comparison of a variable this function has already refused on
//   `if <var> is null`, or that the same `or` group checks `is null`, or
//   that is set from coalesce(...) or a never-null helper;
// - a condition on the KNOWN_SAFE list below, with its reason;
// - anything on a line carrying `-- null-safe: <why>`.
// Anything else fails, naming the function and the condition.
//
//   node scripts/check-null-guards.mjs

import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url).pathname;
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const dbUrl = status.split("\n").find((l) => l.startsWith("DB_URL="))?.slice(7).replace(/^"|"$/g, "") ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(dbUrl)) {
  console.error("check:null-guards needs the local stack, built from the migrations (npm run db:test).");
  process.exit(1);
}

/** Helpers proven never to return null (null_guards.test.sql checks each, for every kind of caller). */
const NEVER_NULL = ["is_admin", "is_owner", "admin_finishing_stripe", "admin_refund_limit_cents"];

/**
 * Conditions that are null-safe for a reason the check can't see, by
 * function and a piece of the condition, each with that reason. Kept short:
 * a new entry needs a reason a reviewer can check.
 */
const KNOWN_SAFE = [
  { fn: "public.admin_members_keep_an_owner()", part: "old.role = 'owner'", why: "role and status are not-null columns" },
  { fn: "public.experience_sessions_booked_guard()", part: "auth.role()) = 'authenticated'", why: "a null auth.role() is a direct database caller, deliberately let through (the guard is for API users)" },
  { fn: "public.guides_guard()", part: "auth.role()) = 'authenticated'", why: "a null auth.role() is a direct database caller, deliberately let through (the guard is for API users)" },
];
const ROLE_TEST = /\b(v_role|v_old_role|role|admin_role|admin_role_of|is_owner|is_admin|auth\.role|v_owner)\b/i;
const REFUSAL = /raise\s+exception[\s\S]*?(insufficient_privilege|'42501')/i;

const rows = execFileSync("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', replace(encode(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'base64'), E'\\n', '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
   order by 1`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    return { name: l.slice(0, i), body: Buffer.from(l.slice(i + 1).replace(/\s/g, ""), "base64").toString("utf8") };
  });

/** Top-level and/or parts of an expression (one part: a single term). */
const splitTop = (e) => split(e, "or").flatMap((g) => split(g, "and"));

/** Splits on top-level `and`/`or` (outside parentheses and quotes). */
function split(cond, word) {
  const parts = [];
  let depth = 0, quote = false, start = 0;
  const re = new RegExp(`^\\s+${word}\\s+`, "i");
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i];
    if (c === "'") quote = !quote;
    if (quote) continue;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0) {
      const m = re.exec(cond.slice(i));
      if (m) { parts.push(cond.slice(start, i)); i += m[0].length - 1; start = i + 1; }
    }
  }
  parts.push(cond.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
const unwrap = (s) => {
  let t = s.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0, whole = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      if (t[i] === ")") depth--;
      if (depth === 0 && i < t.length - 1) { whole = false; break; }
    }
    if (!whole) break;
    t = t.slice(1, -1).trim();
  }
  return t;
};

function safeAtom(atom, nullChecked, groupNullChecked) {
  const a = unwrap(atom);
  if (/\bis\s+(not\s+)?(null|true|false|distinct\s+from|unknown)\b/i.test(a)) return true;
  if (/^(not\s+)?exists\s*\(/i.test(a)) return true;
  if (/^coalesce\s*\(/i.test(a) || /^not\s+coalesce\s*\(/i.test(a)) return true;
  const call = /^(not\s+)?(?:\(\s*select\s+)?(?:public\.)?([a-z_]+)\s*\([^()]*\)\s*\)?$/i.exec(a);
  if (call && NEVER_NULL.includes(call[2].toLowerCase())) return true;
  const notVar = /^not\s+([a-z_][a-z0-9_]*)$/i.exec(a);
  if (notVar && nullChecked.has(notVar[1].toLowerCase())) return true;
  if (/^[a-z_][a-z0-9_]*$/i.test(a) && nullChecked.has(a.toLowerCase())) return true;
  if (/^not\s+/i.test(a) && !/^not\s+exists/i.test(a)) {
    const inner = unwrap(a.replace(/^not\s+/i, ""));
    if (split(inner, "and").length > 1 || split(inner, "or").length > 1) return check(inner, nullChecked);
    return false;
  }
  // A comparison of something already known not to be null.
  const left = /^([a-z_][a-z0-9_.]*)\s*(=|<>|!=|<=|>=|<|>|\bin\b|\bnot\s+in\b|~|\blike\b|\bilike\b)/i.exec(a);
  if (left) {
    const v = left[1].toLowerCase();
    if (nullChecked.has(v) || groupNullChecked.has(v)) return true;
  }
  return false;
}
/** A whole condition: every part null-safe. */
function check(cond, nullChecked) {
  return split(cond, "or").every((group) => {
    const atoms = split(group, "and");
    const groupNull = new Set();
    for (const g of split(cond, "or")) {
      const m = /^([a-z_][a-z0-9_.]*)\s+is\s+null$/i.exec(unwrap(g));
      if (m) groupNull.add(m[1].toLowerCase());
    }
    return atoms.every((atom) => safeAtom(atom, nullChecked, groupNull));
  });
}

const problems = [];
let checked = 0;
for (const fn of rows) {
  const body = fn.body;
  // Variables the function refuses on `if <var> is null` (anywhere before use counts as before: the check runs top-down).
  const nullChecked = new Set();
  const lines = body.split("\n");
  // Variables set from coalesce(...) or a never-null helper can't be null.
  for (const l of lines) {
    // A whole assignment on one line (ending in ";"): a longer one isn't trusted.
    const set = /^\s*([a-z_][a-z0-9_]*)\s+(?:[a-z_][a-z0-9_ ]*?\s*)?:=\s*(.+?);\s*$/i.exec(l);
    if (!set) continue;
    const value = set[2].trim().replace(/;$/, "");
    const helper = /^(?:public\.)?([a-z_]+)\s*\([^()]*\)$/i.exec(value);
    if (/^coalesce\s*\(/i.test(value) && splitTop(value).length === 1) nullChecked.add(set[1].toLowerCase());
    else if (helper && NEVER_NULL.includes(helper[1].toLowerCase())) nullChecked.add(set[1].toLowerCase());
  }
  for (let i = 0; i < lines.length; i++) {
    const head = /^\s*(if|elsif)\s+([\s\S]*)$/i.exec(lines[i]);
    if (!head) continue;
    // The condition, up to its `then` (possibly over several lines).
    let cond = head[2];
    let j = i;
    while (!/\bthen\s*(--.*)?$/i.test(cond) && j + 1 < lines.length) cond += " " + lines[++j].trim();
    const note = lines.slice(i, j + 1).some((l) => /--\s*null-safe:\s*\S/.test(l));
    cond = cond.replace(/--.*$/gm, "").replace(/\bthen\s*$/i, "").trim();
    // Its branch: the lines up to the next elsif/else/end if at this depth (a few lines is enough here).
    const branch = lines.slice(j + 1, j + 8).join("\n").split(/^\s*(elsif|else|end if)\b/im)[0] ?? "";
    const refuses = REFUSAL.test(branch);
    const isNullRefusal = /^([a-z_][a-z0-9_]*)\s+is\s+null$/i.exec(cond);
    if (isNullRefusal && /raise\s+exception/i.test(branch)) nullChecked.add(isNullRefusal[1].toLowerCase());
    if (!refuses && !ROLE_TEST.test(cond)) continue;
    checked++;
    if (note || check(cond, nullChecked)) continue;
    if (KNOWN_SAFE.some((k) => k.fn === fn.name && cond.includes(k.part))) continue;
    problems.push(`${fn.name}: \`${head[1]} ${cond.replace(/\s+/g, " ")} then\` can be null, and a null skips it. Use is [not] null, is not true, is [not] distinct from or coalesce(), refuse the null first, or mark the line -- null-safe: <why>.`);
  }
}

if (problems.length) {
  console.error(`check:null-guards found ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check:null-guards: ${checked} refusals and role tests in ${rows.length} functions, each safe from a null.`);
