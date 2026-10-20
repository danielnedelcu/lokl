// retryReadsFetch (packages/types/src/retryReads.ts): a REST API read that
// met a gateway error is asked again once; nothing else ever is. And the two
// database functions that record a view of contact details stay POST, so
// they are never retried.
// Run: npx tsx packages/ui/tests/read-retry.test.mts (part of `npm run test:ui`).
import { execFileSync } from "node:child_process";
import { isRetryableRead, retryReadsFetch } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const API = "http://127.0.0.1:55321/rest/v1";
// A fake server answering each request with the next status in turn.
const server = (...statuses: number[]) => {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as typeof fetch;
  return { f, seen };
};

let s = server(502, 200);
let res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_team`);
check(res.status === 200 && s.seen.length === 2, "1. a GET met by a 502 is asked again, and the second answer returned");
s = server(503, 200);
res = await retryReadsFetch(s.f, 0)(new Request(`${API}/cities?select=id`, { method: "HEAD" }));
check(res.status === 200 && s.seen.length === 2, "2. a HEAD (a count) met by a 503 is asked again");
s = server(502, 502, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/cities`);
check(res.status === 502 && s.seen.length === 2, "3. only once: a second 502 is returned as it is");
s = server(502, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_booking_contact`, { method: "POST", body: "{}" });
check(res.status === 502 && s.seen.length === 1, "4. a POST (a function that writes, or records a view) is never retried");
for (const method of ["PATCH", "DELETE", "PUT"]) {
  s = server(502, 200);
  res = await retryReadsFetch(s.f, 0)(`${API}/bookings?id=eq.x`, { method });
  check(res.status === 502 && s.seen.length === 1, `5. a ${method} is never retried`);
}
s = server(500, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/cities`);
check(res.status === 500 && s.seen.length === 1, "6. a 500 (the database's own error) isn't retried");
s = server(502, 200);
res = await retryReadsFetch(s.f, 0)("http://127.0.0.1:55321/auth/v1/user");
check(res.status === 502 && s.seen.length === 1, "7. only the REST API: an auth or other request isn't retried");
check(isRetryableRead(`${API}/rpc/admin_my_limits?x=1`, "get") && !isRetryableRead("not a url"), "8. methods in any case; a bad URL isn't retried");

// The functions that record each view are called with POST, never { get: true }.
const calls = execFileSync("git", ["grep", "-n", "-E", "rpc\\(\\s*\"admin_(booking|provider)_contact\"", "--", "apps", "packages"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
check(calls.length >= 2, `9a. the contact functions are called (${calls.length} places)`);
check(calls.every((l) => !l.includes("get: true")), "9b. ...and never with { get: true }, so never retried");

console.log(failures ? `${failures} failed` : "All read-retry checks passed.");
process.exit(failures ? 1 : 0);
