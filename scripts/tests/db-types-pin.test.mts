// The database types' PostgREST version is always hosted's
// (scripts/db-types-pin.mjs): added when the generator leaves the block
// out, replaced when it writes its own (the local stack's 14.5).
// Run: npx tsx scripts/tests/db-types-pin.test.mts
import { pinPostgrestVersion, statedPostgrestVersions } from "../db-types-pin.mjs";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const body = "  public: {\n    Tables: {}\n  }\n}\n";
const bare = `export type Json = string\n\nexport type Database = {\n${body}`;
const withLocal = `export type Json = string\n\nexport type Database = {\n  // Allows to automatically instantiate createClient with right options\n  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)\n  __InternalSupabase: {\n    PostgrestVersion: "14.5"\n  }\n${body}`;
const withLocalNoComment = `export type Json = string\n\nexport type Database = {\n  __InternalSupabase: {\n    PostgrestVersion: "14.5";\n  };\n${body}`;

const added = pinPostgrestVersion(bare, "14.17");
check(JSON.stringify(statedPostgrestVersions(added)) === '["14.17"]', "1. no block from the generator: one is added, with hosted's version");
const replaced = pinPostgrestVersion(withLocal, "14.17");
check(JSON.stringify(statedPostgrestVersions(replaced)) === '["14.17"]' && !replaced.includes("14.5"), "2. the generator's block (local 14.5): replaced with hosted's");
check(replaced.split("Allows to automatically").length === 2, "3. ...with its comment once, not twice");
const replacedBare = pinPostgrestVersion(withLocalNoComment, "14.17");
check(JSON.stringify(statedPostgrestVersions(replacedBare)) === '["14.17"]' && !replacedBare.includes("14.5"), "4. a block without the comment, as Prettier writes it: replaced too");
check(pinPostgrestVersion(replaced, "14.17") === replaced, "5. pinning twice changes nothing");
let refused = "";
try { pinPostgrestVersion("export type Other = {}\n", "14.17"); } catch (e) { refused = (e as Error).message; }
check(refused.includes("don't start as expected"), "6. output that doesn't start as expected is refused, not guessed at");

console.log(failures ? `${failures} failed` : "All database type pin checks passed.");
process.exit(failures ? 1 : 0);
