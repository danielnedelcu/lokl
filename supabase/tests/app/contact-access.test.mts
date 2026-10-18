// The providers' 30-day limit on customers' contact details has one number
// in two places (2026-10-18): the database enforces it in the read rules of
// booking_contacts and booking_addresses (migration contact_access_30_days),
// and CONTACT_ACCESS_DAYS in @repo/types words the provider's pages and the
// help. This reads both rules' definitions from the LOCAL database (built
// from the migrations) and fails if either's interval isn't
// CONTACT_ACCESS_DAYS, or the rule has lost its limit.
// Run: npx tsx supabase/tests/app/contact-access.test.mts (part of db:test:app:core).
import { execFileSync } from "node:child_process";
import { CONTACT_ACCESS_DAYS } from "@repo/types";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(local.DB_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };

const rows = execFileSync("psql", [local.DB_URL!, "-qAt", "-F", "|", "-c",
  `select tablename, regexp_replace(qual, '\\s+', ' ', 'g') from pg_policies where schemaname = 'public'
     and policyname in ('booking_contacts_read_provider', 'booking_addresses_read_provider') order by tablename`],
{ encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => {
  const [table, qual] = [l.slice(0, l.indexOf("|")), l.slice(l.indexOf("|") + 1)];
  return { table, qual };
});

check(rows.length === 2, `1. both providers' read rules are there (${rows.map((r) => r.table).join(", ")})`);
for (const { table, qual } of rows) {
  // Postgres prints the interval as '30 days'::interval.
  const days = [...qual.matchAll(/'(\d+) days?'::interval/g)].map((m) => Number(m[1]));
  check(days.length === 1 && days[0] === CONTACT_ACCESS_DAYS && /now\(\) - '\d+ days?'::interval/.test(qual),
    `2. ${table}: the provider reads it until ${CONTACT_ACCESS_DAYS} days after the booking (the rule says ${days.join(", ") || "no limit"})`);
}

console.log(failures ? `${failures} failed` : "All contact access checks passed.");
process.exit(failures ? 1 : 0);
