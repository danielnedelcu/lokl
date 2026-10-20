// The browser tests' setup client (e2e/support/retrySetupWrites.ts): after
// a gateway 502, an update or delete of one row by id is sent once more;
// nothing else ever is (inserts, upserts, function calls, reads, filters
// other than by id).
// Run: npx tsx scripts/tests/retry-setup-writes.test.mts (part of `npm run test:ui`).
import { retrySetupWrites } from "../../e2e/support/retrySetupWrites";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const API = "http://127.0.0.1:55321/rest/v1";
const ID = "4033aa2d-5bef-48a8-bc79-b16e3de19d1e";
const server = (...statuses: number[]) => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls: () => calls };
};
const send = async (url: string, method: string, ...statuses: number[]) => {
  const s = server(...statuses);
  const res = await retrySetupWrites(s.f, 0)(url, { method, body: method === "DELETE" ? undefined : "{}" });
  return { status: res.status, calls: s.calls() };
};

let r = await send(`${API}/providers?id=eq.${ID}`, "PATCH", 502, 200);
check(r.status === 200 && r.calls === 2, "1. an update of one row by id is asked again after a 502");
r = await send(`${API}/providers?id=eq.${ID}&select=slug`, "PATCH", 502, 200);
check(r.status === 200 && r.calls === 2, "2. ...with other query parts too");
r = await send(`${API}/guides?id=eq.${ID}`, "DELETE", 502, 200);
check(r.status === 200 && r.calls === 2, "3. a delete by id too");
r = await send(`${API}/providers?id=eq.${ID}`, "PATCH", 502, 502, 200);
check(r.status === 502 && r.calls === 2, "4. once only");
r = await send(`${API}/providers`, "POST", 502, 200);
check(r.status === 502 && r.calls === 1, "5. an insert is never asked again");
r = await send(`${API}/providers?on_conflict=id`, "POST", 502, 200);
check(r.status === 502 && r.calls === 1, "6. nor an upsert");
r = await send(`${API}/rpc/publish_guide`, "POST", 502, 200);
check(r.status === 502 && r.calls === 1, "7. nor a function call");
r = await send(`${API}/providers?id=eq.${ID}`, "POST", 502, 200);
check(r.status === 502 && r.calls === 1, "7b. a POST is never asked again, even one naming an id");
r = await send(`${API}/providers?owner_id=eq.${ID}`, "PATCH", 502, 200);
check(r.status === 502 && r.calls === 1, "8. nor an update by anything but id");
r = await send(`${API}/providers?id=in.(${ID})`, "PATCH", 502, 200);
check(r.status === 502 && r.calls === 1, "9. nor by a list of ids");
r = await send(`${API}/providers?id=eq.${ID}`, "PATCH", 500, 200);
check(r.status === 500 && r.calls === 1, "10. only a gateway 502, never the database's own error");
r = await send(`http://127.0.0.1:55321/auth/v1/admin/users/${ID}?id=eq.${ID}`, "DELETE", 502, 200);
check(r.status === 502 && r.calls === 1, "11. only the REST API");

console.log(failures ? `${failures} failed` : "All setup retry checks passed.");
process.exit(failures ? 1 : 0);
