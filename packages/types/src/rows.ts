// Reading more rows than the API returns at once. The API (PostgREST)
// returns at most API_MAX_ROWS rows per request, with no error (max_rows in
// supabase/config.toml, the same on hosted). Lists people page through are
// paged on the server instead; allRows() is for reads that genuinely need
// every row, such as the sitemap, and stops at a stated maximum.

/** The API's row limit per request (`max_rows`); a test checks it matches config.toml. */
export const API_MAX_ROWS = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Every row of a read, a page of API_MAX_ROWS at a time. `page(from, to)`
 * must apply `.range(from, to)` to a query ordered by a unique key, or rows
 * can repeat or go missing between pages. Throws past `max` rows.
 */
export async function allRows<T>(page: (from: number, to: number) => Page<T>, max: number): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += API_MAX_ROWS) {
    const { data, error } = await page(from, from + API_MAX_ROWS - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (rows.length > max) throw new Error(`More than ${max} rows: page this read instead of reading every row.`);
    if (!data || data.length < API_MAX_ROWS) return rows;
  }
}

/**
 * Whether a response was probably cut off at the API's row limit: a read
 * (GET, or a set-returning function) that asked for no limit or range and
 * got exactly API_MAX_ROWS rows back (from its Content-Range header). A
 * page asked for on purpose (allRows, .range(), .limit()) never counts.
 */
export function rowLimitHit(url: string, requestHeaders: Headers, responseHeaders: Headers, method = "GET"): boolean {
  // A count-only read (head: true) returns no rows, whatever its range says.
  if (method.toUpperCase() === "HEAD") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!u.pathname.includes("/rest/v1/")) return false;
  if (u.searchParams.has("limit") || u.searchParams.has("offset") || requestHeaders.has("range")) return false;
  const m = /^(\d+)-(\d+)\//.exec(responseHeaders.get("content-range") ?? "");
  return !!m && Number(m[2]) - Number(m[1]) + 1 >= API_MAX_ROWS;
}

/** The message for a read that was probably cut off: the table or function, never the query. */
export function rowLimitMessage(url: string) {
  const what = new URL(url).pathname.replace(/^.*\/rest\/v1\//, "");
  return `A read of ${what} returned exactly ${API_MAX_ROWS} rows without asking for a limit, so it was probably cut off at the API's row limit. Page it, count it in the database, or use allRows().`;
}

/**
 * A fetch that checks every API read with rowLimitHit(): "throw" makes the
 * read fail (tests), "warn" logs it (production). Installed on the apps'
 * global fetch (server and browser) and in the app tests.
 */
export function rowLimitFetch(base: typeof fetch, mode: "throw" | "warn"): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (rowLimitHit(url, headers, res.headers, method)) {
      if (mode === "throw") throw new Error(rowLimitMessage(url));
      console.warn(`[row limit] ${rowLimitMessage(url)}`);
    }
    return res;
  };
}
