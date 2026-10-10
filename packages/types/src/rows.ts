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
