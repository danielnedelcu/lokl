// The search results address (docs/design/search.md): built in a fixed
// order, read back the same, and malformed values dropped, never an error.
// Run: npx tsx packages/ui/tests/search-address.test.mts (part of `npm run test:ui`).
import { readSearch, searchPath } from "../../types/src/search";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const AREA = "0b8a2c1e-4f5d-4e6a-9b7c-1d2e3f4a5b6c";
const back = (path: string) => readSearch(Object.fromEntries(new URL(path, "https://x.test").searchParams));

// 1. Everything: a fixed order, and it reads back the same.
const all = { area: AREA, from: "2026-10-17", to: "2026-10-18", kind: "experience" as const, category: "food-walks", page: 2 };
const path = searchPath("atlanta", all);
check(path === `/atlanta/search?area=${AREA}&from=2026-10-17&to=2026-10-18&kind=experience&category=food-walks&page=2`, `1a. the address (${path})`);
check(same(back(path), all), "1b. it reads back the same");

// 2. Nothing chosen: just the page.
check(searchPath("atlanta", {}) === "/atlanta/search" && same(readSearch({}), {}), "2. no filters: /atlanta/search");

// 3. Malformed values are dropped.
check(same(readSearch({ area: "not-an-id", from: "17/10/2026", kind: "tours", category: "x", page: "-3" }), {}), "3a. a bad area, date, kind and page are dropped");
check(same(readSearch({ category: "food-walks" }), {}), "3b. a category without its kind is dropped (slugs are unique only within a kind)");
check(same(readSearch({ kind: "service", category: "Bad Slug!" }), { kind: "service" }), "3c. a malformed slug is dropped, the kind kept");
check(same(readSearch({ page: "1" }), {}) && searchPath("atlanta", { page: 1 }) === "/atlanta/search", "3d. page 1 isn't in the address");

// 4. Dates: one alone is that day; backwards is put right.
check(same(readSearch({ from: "2026-10-17" }), { from: "2026-10-17", to: "2026-10-17" }), "4a. a from date alone is that one day");
check(same(readSearch({ from: "2026-10-18", to: "2026-10-17" }), { from: "2026-10-17", to: "2026-10-18" }), "4b. a range given backwards is put right");
check(same(readSearch({ area: [AREA, "x"] }), { area: AREA }), "4c. a repeated value: the first counts");
check(searchPath("atlanta", { from: "2026-10-17" }) === "/atlanta/search?from=2026-10-17&to=2026-10-17", "4d. one day chosen alone is searched as that day");

console.log(failures ? `${failures} failed` : "All search address checks passed.");
process.exit(failures ? 1 : 0);
