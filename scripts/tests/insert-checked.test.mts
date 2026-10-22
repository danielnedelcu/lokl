// The browser tests' checked setup inserts (e2e/support/insertChecked.ts):
// after a gateway 502 the rows' own keys are read back; the insert is sent
// once more only if none went in, never when they did, and a partial or any
// other error fails.
// Run: npx tsx scripts/tests/insert-checked.test.mts (part of `npm run test:ui`).
import { insertChecked, type InsertClient } from "../../e2e/support/insertChecked";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

/**
 * A fake table: each insert answers with the next status (and stores its
 * rows when `stores` says so, as a 502 after the insert ran would); reads
 * see what was stored.
 */
function fakeTable(answers: { status: number; stores: boolean }[]) {
  const stored: Record<string, unknown>[] = [];
  let inserts = 0;
  let reads = 0;
  const db: InsertClient = {
    from: () => ({
      insert: async (rows) => {
        inserts++;
        const a = answers.shift() ?? { status: 201, stores: true };
        if (a.stores) stored.push(...rows);
        return a.status < 300 ? { error: null, status: a.status } : { error: { message: `status ${a.status}` }, status: a.status };
      },
      select: (column) => ({
        in: async (_c, values) => {
          reads++;
          return { data: stored.filter((r) => values.includes(r[column])), error: null };
        },
      }),
    }),
  };
  return { db, stored, inserts: () => inserts, reads: () => reads };
}
const rows = [{ id: "a1", name: "one" }, { id: "a2", name: "two" }];
const quiet = console.warn;
console.warn = () => {};

let t = fakeTable([{ status: 201, stores: true }]);
check(await insertChecked(t.db, "things", rows) === "inserted" && t.inserts() === 1 && t.reads() === 0, "1. an insert that goes in: sent once, nothing read");

t = fakeTable([{ status: 502, stores: true }]);
check(await insertChecked(t.db, "things", rows) === "already in after a 502" && t.inserts() === 1 && t.stored.length === 2,
  "2. a 502 after the rows went in: read back, not sent again (no copies)");

t = fakeTable([{ status: 502, stores: false }, { status: 201, stores: true }]);
check(await insertChecked(t.db, "things", rows) === "inserted after a 502" && t.inserts() === 2 && t.stored.length === 2,
  "3. a 502 before they went in: sent once more");

t = fakeTable([{ status: 502, stores: false }, { status: 502, stores: false }]);
let msg = "";
try { await insertChecked(t.db, "things", rows); } catch (e) { msg = (e as Error).message; }
check(msg === "status 502" && t.inserts() === 2, "4. only once more: a second 502 fails the setup");

t = fakeTable([{ status: 409, stores: false }]);
msg = "";
try { await insertChecked(t.db, "things", rows); } catch (e) { msg = (e as Error).message; }
check(msg === "status 409" && t.inserts() === 1 && t.reads() === 0, "5. any other error is the test's to see, unchanged and not retried");

t = fakeTable([{ status: 502, stores: false }]);
t.stored.push(rows[0]!);
msg = "";
try { await insertChecked(t.db, "things", rows); } catch (e) { msg = (e as Error).message; }
check(msg.includes("1 of 2 rows are in") && t.inserts() === 1, "6. some in and some not: an error, never a second insert");

t = fakeTable([]);
msg = "";
try { await insertChecked(t.db, "things", [{ name: "no id" }]); } catch (e) { msg = (e as Error).message; }
check(msg.includes("every row needs its id") && t.inserts() === 0, "7. a row without its key is refused before anything is sent");

t = fakeTable([{ status: 502, stores: true }]);
check(await insertChecked(t.db, "admin_members", [{ user_id: "u1", role: "owner" }], "user_id") === "already in after a 502",
  "8. a natural key works the same way (a login's user id)");

console.warn = quiet;
console.log(failures ? `${failures} failed` : "All checked-insert checks passed.");
process.exit(failures ? 1 : 0);
