// One retry for an API read that met a gateway error (2026-10-20). Kong
// answers 502 or 503 when PostgREST drops a connection mid-request, as it
// does when it reloads its schema cache and rebuilds its pool (seen in CI:
// the owner's team list failed once in journey 40). A read can simply be
// asked again; anything else can't, since the first attempt may have done
// its work before the answer was lost. So only GET and HEAD to the REST API
// are retried: table reads, and database functions that purely read
// (`stable`, called with `{ get: true }`, which PostgREST runs read-only).
// Every POST, PATCH and DELETE, and every function called with POST (those
// that write, or record a view as admin_booking_contact and
// admin_provider_contact do), is never retried.

/** The statuses a read is asked again for: the gateway lost or refused the upstream answer. */
export const READ_RETRY_STATUSES = [502, 503] as const;
const RETRY_DELAY_MS = 250;

/** Whether a request may be retried once: a GET or HEAD to the REST API (`/rest/v1/`). */
export function isRetryableRead(url: string, method = "GET"): boolean {
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return false;
  try {
    return new URL(url).pathname.includes("/rest/v1/");
  } catch {
    return false;
  }
}

/**
 * A fetch that asks a REST API read again, once, after a short pause, when
 * the gateway answers 502 or 503. Installed on the apps' global fetch
 * (server and browser), next to rowLimitFetch.
 */
export function retryReadsFetch(base: typeof fetch, delayMs = RETRY_DELAY_MS): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (!(READ_RETRY_STATUSES as readonly number[]).includes(res.status)) return res;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!isRetryableRead(url, method)) return res;
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, delayMs));
    return base(input, init);
  };
}
