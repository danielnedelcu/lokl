// changedRows (packages/ui/app/utils/changedRows.ts): an update or delete
// that changes no row is an error, never a silent success.
// Run: npx tsx packages/ui/tests/changed-rows.test.mts (part of `npm run test:ui`).
import { changedRows, NothingChangedError, problemText } from "../app/utils/changedRows";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

check(changedRows({ data: [{ id: "a" }], error: null }) === null, "1. a row changed: no error");
const none = changedRows({ data: [], error: null }, "deleted");
check(none instanceof NothingChangedError && none.message.startsWith("Nothing was deleted"), "2. no row changed: an error that says nothing was deleted");
check(changedRows({ data: null, error: null }) instanceof NothingChangedError, "3. no data at all: the same error");
const dbError = { message: "permission denied", code: "42501" };
check(changedRows({ data: null, error: dbError }) === dbError, "4. the database's own error is passed through");
check(problemText(none, "The page's message.") === none!.message, "5. the person is told nothing changed, and to refresh");
check(problemText(dbError, "The page's message.") === "The page's message.", "6. any other error keeps the page's message");

console.log(failures ? `${failures} failed` : "All changed-rows checks passed.");
process.exit(failures ? 1 : 0);
