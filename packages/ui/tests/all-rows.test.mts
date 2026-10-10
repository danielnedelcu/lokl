// allRows(), API_MAX_ROWS and the runtime row-limit check
// (packages/types/src/rows.ts): every row, a page at a time; a stop at the
// stated maximum; the constant matching supabase/config.toml; and which
// responses count as cut off.
// Run: npx tsx packages/ui/tests/all-rows.test.mts (part of `npm run test:ui`).
import fs from "node:fs";
import { allRows, API_MAX_ROWS, rowLimitFetch, rowLimitHit } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
// A fake table of n rows, served as the API would: at most API_MAX_ROWS per request.
const table = (n: number) => {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(n, to + 1, from + API_MAX_ROWS);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { page, calls };
};

const t1 = table(2500);
const r1 = await allRows(t1.page, 10_000);
check(r1.length === 2500 && r1.every((v, i) => v === i), "1. 2,500 rows come back in full and in order");
check(t1.calls.length === 3 && t1.calls[2]![0] === 2000, "2. ...in three requests of up to 1,000");
const t2 = table(1000);
check((await allRows(t2.page, 10_000)).length === 1000 && t2.calls.length === 2, "3. exactly 1,000 rows: one more request finds the end");
const t3 = table(0);
check((await allRows(t3.page, 10)).length === 0, "4. no rows");
let message = "";
try { await allRows(table(3000).page, 2500); } catch (e) { message = (e as Error).message; }
check(message === "More than 2500 rows: page this read instead of reading every row.", "5. past the stated maximum, it stops with an error");
let failed = "";
try { await allRows(async () => ({ data: null, error: { message: "boom" } }), 10); } catch (e) { failed = (e as Error).message; }
check(failed === "boom", "6. the database's error is passed through");
const config = fs.readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
check(new RegExp(`^max_rows = ${API_MAX_ROWS}$`, "m").test(config), "7. API_MAX_ROWS matches max_rows in supabase/config.toml");

// The runtime check.
const api = "http://127.0.0.1:55321/rest/v1/listings?select=id&status=eq.live";
const h = (range?: string) => new Headers(range ? { "content-range": range } : {});
const none = new Headers();
check(rowLimitHit(api, none, h("0-999/*")), "8a. 1,000 rows from a read with no limit: cut off");
check(rowLimitHit(api, none, h("0-999/4000")), "8b. ...also with a count");
check(!rowLimitHit(api, none, h("0-998/*")), "8c. 999 rows: complete");
check(!rowLimitHit(`${api}&limit=1000`, none, h("0-999/*")), "8d. 1,000 rows from .limit(1000): asked for");
check(!rowLimitHit(`${api}&offset=1000&limit=1000`, none, h("1000-1999/*")), "8e. a page from allRows/.range(): asked for");
check(!rowLimitHit(api, new Headers({ range: "0-999" }), h("0-999/*")), "8f. a Range header: asked for");
check(!rowLimitHit("http://127.0.0.1:55321/auth/v1/user", none, h("0-999/*")), "8g. not an API read: ignored");
check(!rowLimitHit(api, none, h()), "8h. no Content-Range: ignored");
check(!rowLimitHit(api, none, h("0-999/1500"), "HEAD"), "8i. a count-only read (HEAD): ignored");
const fake = (range: string) => (async () => new Response("[]", { headers: { "content-range": range } })) as unknown as typeof fetch;
let thrown = "";
try { await rowLimitFetch(fake("0-999/*"), "throw")(api); } catch (e) { thrown = (e as Error).message; }
check(thrown.startsWith("A read of listings returned exactly 1000 rows without asking for a limit"), "9a. throw mode: the read fails, naming the table only");
const warned: string[] = [];
const warn = console.warn;
console.warn = (m: string) => { warned.push(m); };
const res = await rowLimitFetch(fake("0-999/*"), "warn")(api);
console.warn = warn;
check(res.ok && warned.length === 1 && warned[0]!.startsWith("[row limit]"), "9b. warn mode: the read goes through, with a warning");
let quiet = true;
try { await rowLimitFetch(fake("0-499/*"), "throw")(api); } catch { quiet = false; }
check(quiet, "9c. a complete read passes untouched");

console.log(failures ? `${failures} failed` : "All allRows checks passed.");
process.exit(failures ? 1 : 0);
