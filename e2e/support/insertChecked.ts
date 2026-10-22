// Setup inserts that survive a gateway 502 (decided 2026-10-21). Under load
// the API gateway sometimes sends a request down a connection PostgREST has
// just dropped, and answers 502 without knowing whether the insert ran; it
// never retries a write itself (docs/TODO.md, Hardening). It failed setups
// locally and on CI, on PRs that couldn't have caused it.
//
// An insert can't just be sent again: if the first one went in, the second
// would add a copy. So the test chooses each row's key itself (an id from
// randomUUID, or the natural key: a login's user id, a listing's address by
// listing id, a homepage position), and after a 502 reads those keys back:
// all there, the first insert went in; none, it didn't, so it's sent once
// more; some, which one statement can't do, is an error. Any other error is
// the test's to see, unchanged.

/** The part of a Supabase client used here (tests pass a fake). */
export interface InsertClient {
  from(table: string): {
    insert(rows: Record<string, unknown>[]): PromiseLike<{ error: { message: string } | null; status: number }>;
    select(columns: string): {
      in(column: string, values: unknown[]): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Inserts setup rows whose `key` (default `id`) the test chose. After a
 * gateway 502, checks whether they went in and, only if none did, inserts
 * them once more. Returns how it went, for the test's own check.
 */
export async function insertChecked(
  db: InsertClient,
  table: string,
  rows: Record<string, unknown>[],
  key = "id",
): Promise<"inserted" | "inserted after a 502" | "already in after a 502"> {
  const keys = rows.map((r) => r[key]);
  if (!rows.length || keys.some((k) => k === undefined || k === null)) {
    throw new Error(`insertChecked(${table}): every row needs its ${key}, chosen by the test.`);
  }
  const first = await db.from(table).insert(rows);
  if (!first.error) return "inserted";
  if (first.status !== 502) throw new Error(first.error.message);

  const found = await db.from(table).select(key).in(key, keys);
  if (found.error) throw new Error(`After a gateway 502 on ${table}, the check failed too: ${found.error.message}`);
  const n = found.data?.length ?? 0;
  if (n === rows.length) {
    console.warn(`[setup] ${table}: a gateway 502, but the rows were in; not inserted again.`);
    return "already in after a 502";
  }
  if (n > 0) throw new Error(`After a gateway 502 on ${table}, ${n} of ${rows.length} rows are in: one insert can't do that.`);
  const second = await db.from(table).insert(rows);
  if (second.error) throw new Error(second.error.message);
  console.warn(`[setup] ${table}: a gateway 502, and nothing went in; inserted once more.`);
  return "inserted after a 502";
}
