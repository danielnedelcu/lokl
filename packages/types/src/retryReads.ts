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
// admin_provider_contact do), is never retried, with one listed exception:
//
// Search reads (2026-10-21): the admin lists that take search text stay
// POST, so the text stays out of URLs and access logs, yet they purely
// read. Those named in SEARCH_READS are retried once too. Each must be
// `stable` and take search text (`p_q`), and is called as an admin inside a
// read-only transaction: supabase/tests/app/search-reads.test.mts fails
// otherwise, so a function that writes can never be retried.

/** The statuses a read is asked again for: the gateway lost or refused the upstream answer. */
export const READ_RETRY_STATUSES = [502, 503] as const;
const RETRY_DELAY_MS = 250;

/** Database functions called with POST that purely read and take search text: retried like a GET. */
export const SEARCH_READS = ["admin_bookings_page", "admin_listings_page", "admin_providers_page", "admin_support_board"] as const;

/**
 * Whether a request may be retried once: a GET or HEAD to the REST API
 * (`/rest/v1/`), or a POST to exactly one of the SEARCH_READS functions.
 */
export function isRetryableRead(url: string, method = "GET"): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return path.includes("/rest/v1/");
  if (m !== "POST") return false;
  const fn = /\/rest\/v1\/rpc\/([^/]+)$/.exec(path)?.[1];
  return !!fn && (SEARCH_READS as readonly string[]).includes(fn);
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
    // A body can only be sent again if it's plain text (supabase-js sends JSON text).
    if (input instanceof Request ? input.body !== null : init?.body != null && typeof init.body !== "string") return res;
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, delayMs));
    return base(input, init);
  };
}
