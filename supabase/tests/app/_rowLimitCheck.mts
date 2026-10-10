// Loaded before each app test (`tsx --import`, see package.json): the test's
// own Supabase clients, and the app code it runs, fail on a read cut off at
// the API's 1,000 rows (rowLimitFetch in @repo/types, "throw"), as the test
// apps do. Its name starts with "_" so it isn't a test itself.
import { rowLimitFetch } from "@repo/types";

globalThis.fetch = rowLimitFetch(globalThis.fetch, "throw");
