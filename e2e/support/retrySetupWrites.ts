// The browser tests' setup client (env.db, the server key) asks once more
// when the API gateway answers 502 to an update or delete of one row by id
// (2026-10-20). Under the load of parallel tests the gateway sometimes
// sends a request down a connection PostgREST has just dropped; it retries
// reads itself, but never writes, so a setup write fails the test before it
// starts (journey 27, 2026-10-20). An update or delete by id with set values
// can be repeated safely; inserts, upserts and function calls never are
// (each could do its work twice). Setup inserts are handled by
// insertChecked instead, which reads their keys back first. The apps never
// use either: their writes report a failure to the person (docs/TODO.md).

const BY_ID = /[?&]id=eq\.[0-9a-f-]{36}(&|$)/i;

/** Whether a failed request may be sent once more: a PATCH or DELETE of one row by id, through the REST API, not a function. */
export function isRetryableSetupWrite(url: string, method: string): boolean {
  const m = method.toUpperCase();
  if (m !== "PATCH" && m !== "DELETE") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.pathname.includes("/rest/v1/") && !u.pathname.includes("/rest/v1/rpc/") && BY_ID.test(u.search);
}

/** A fetch that sends a retryable setup write once more after a gateway 502. */
export function retrySetupWrites(base: typeof fetch = fetch, delayMs = 250): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 502) return res;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!isRetryableSetupWrite(url, method)) return res;
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, delayMs));
    return base(input, init);
  };
}
