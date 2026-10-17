// The __InternalSupabase block of the generated database types, always
// pinned to hosted's PostgREST version (scripts/db-types.mjs): whatever the
// generator wrote there (the local stack's version, or nothing), the result
// has exactly one block, with `version`.

const COMMENT = `  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
`;
const OPENING = "export type Database = {\n";
// The generator's own block, with its comment if present.
const GENERATED = /(?:[ \t]*\/\/[^\n]*\n){0,2}[ \t]*__InternalSupabase:\s*\{[^{}]*\}[;,]?\n/g;

/** `types` with its __InternalSupabase block set to `version` (replaced, or added). */
export function pinPostgrestVersion(types, version) {
  if (!types.includes(OPENING)) throw new Error("The generated types don't start as expected; the CLI's output may have changed.");
  const without = types.replace(GENERATED, "");
  if (/__InternalSupabase\s*:/.test(without)) throw new Error("The generated types have an __InternalSupabase block this script can't replace.");
  return without.replace(OPENING, `${OPENING}${COMMENT}  __InternalSupabase: {\n    PostgrestVersion: "${version}"\n  }\n`);
}

/** The PostgREST versions stated in `types` (exactly one is expected). */
export function statedPostgrestVersions(types) {
  return [...types.matchAll(/PostgrestVersion:\s*"([^"]+)"/g)].map((m) => m[1]);
}
