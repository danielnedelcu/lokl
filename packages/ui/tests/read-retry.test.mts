// retryReadsFetch (packages/types/src/retryReads.ts): a REST API read that
// met a gateway error is asked again once; nothing else ever is, except a
// POST to exactly one of the listed search reads (SEARCH_READS; that each
// purely reads is checked against the database in
// supabase/tests/app/search-reads.test.mts). And the two database functions
// that record a view of contact details stay POST, so they are never retried.
// Run: npx tsx packages/ui/tests/read-retry.test.mts (part of `npm run test:ui`).
import { execFileSync } from "node:child_process";
import { isRetryableRead, retryReadsFetch, SEARCH_READS } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const API = "http://127.0.0.1:55321/rest/v1";
// A fake server answering each request with the next status in turn.
const server = (...statuses: number[]) => {
  const seen: string[] = [];
  const bodies: unknown[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    bodies.push(init?.body);
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as typeof fetch;
  return { f, seen, bodies };
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

// The listed search reads: a POST, retried once, with the same body.
const search = JSON.stringify({ p_q: "peach", p_page: 1 });
for (const fn of SEARCH_READS) {
  s = server(502, 200);
  res = await retryReadsFetch(s.f, 0)(`${API}/rpc/${fn}`, { method: "POST", body: search });
  check(res.status === 200 && s.seen.length === 2 && s.bodies[1] === search, `10a. ${fn}: a POST met by a 502 is asked again, with the same body`);
}
s = server(503, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_providers_page`, { method: "POST", body: search });
check(res.status === 200 && s.seen.length === 2, "10b. ...and after a 503");
s = server(502, 502, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_providers_page`, { method: "POST", body: search });
check(res.status === 502 && s.seen.length === 2, "10c. only once: a second 502 is returned as it is");
s = server(500, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_providers_page`, { method: "POST", body: search });
check(res.status === 500 && s.seen.length === 1, "10d. a 500 (the database's own error) isn't retried");
for (const url of [`${API}/rpc/admin_providers_page_extra`, `${API}/rpc/x_admin_providers_page`, `${API}/rpc/admin_providers_page/x`, `${API}/admin_providers_page`]) {
  s = server(502, 200);
  res = await retryReadsFetch(s.f, 0)(url, { method: "POST", body: search });
  check(res.status === 502 && s.seen.length === 1, `10e. only the exact name: ${url.slice(API.length)} isn't retried`);
}
s = server(502, 200);
res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_providers_page`, { method: "POST", body: new Blob([search]) });
check(res.status === 502 && s.seen.length === 1, "10f. a body that isn't plain text isn't sent again");
s = server(502, 200);
res = await retryReadsFetch(s.f, 0)(new Request(`${API}/rpc/admin_providers_page`, { method: "POST", body: search }));
check(res.status === 502 && s.seen.length === 1, "10g. a Request carrying its own body isn't sent again (it's used up)");
for (const method of ["PATCH", "DELETE"]) {
  s = server(502, 200);
  res = await retryReadsFetch(s.f, 0)(`${API}/rpc/admin_providers_page`, { method, body: search });
  check(res.status === 502 && s.seen.length === 1, `10h. a ${method} to a listed name isn't retried`);
}
check(!(SEARCH_READS as readonly string[]).includes("admin_booking_contact") && !(SEARCH_READS as readonly string[]).includes("admin_provider_contact"),
  "10i. the functions that record a view are never on the list");

// The functions that record each view are called with POST, never { get: true }.
const calls = execFileSync("git", ["grep", "-n", "-E", "rpc\\(\\s*\"admin_(booking|provider)_contact\"", "--", "apps", "packages"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
check(calls.length >= 2, `9a. the contact functions are called (${calls.length} places)`);
check(calls.every((l) => !l.includes("get: true")), "9b. ...and never with { get: true }, so never retried");

console.log(failures ? `${failures} failed` : "All read-retry checks passed.");
process.exit(failures ? 1 : 0);
