// An update or delete sent straight to the database (not through a server
// route) that changes no row is an error, never a silent success
// (2026-10-04). Row rules (RLS) and filters don't raise an error when they
// match nothing: the request "works" and changes nothing, so the page would
// say "Saved." for a row that was removed, changed elsewhere, or isn't the
// signed-in user's to change. Found when deleting a guide from the admin's
// list did nothing and said nothing.
//
// Use: end the query with .select("id") (so the changed rows come back),
// then `const e = changedRows(result, "saved")`. Show `problemText(e, ...)`.

/** A write that matched no row. Its message says what to do next. */
export class NothingChangedError extends Error {}

type WriteResult = { data: unknown[] | null; error: { message: string; code?: string } | null };

/** The query's own error, a NothingChangedError if no row changed, or null. */
export function changedRows(result: WriteResult, done: "saved" | "deleted" | "changed" = "saved") {
  if (result.error) return result.error;
  if (!result.data?.length) {
    return new NothingChangedError(
      `Nothing was ${done}: it may have been removed or changed somewhere else. Refresh the page and try again.`,
    );
  }
  return null;
}

/** What to tell the person: the "nothing changed" advice, or the page's own message for any other error. */
export function problemText(error: unknown, otherwise: string) {
  return error instanceof NothingChangedError ? error.message : otherwise;
}
