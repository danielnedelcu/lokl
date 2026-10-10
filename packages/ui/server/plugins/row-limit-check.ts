import { rowLimitFetch } from "@repo/types";

// Every server-side API read in both apps goes through the global fetch
// (Supabase clients pick it up when they're made, per request), so wrapping
// it checks them all for a read cut off at the API's 1,000 rows. See
// rowLimitFetch in @repo/types; the mode is runtimeConfig.public.rowLimitCheck.
export default defineNitroPlugin(() => {
  const mode = useRuntimeConfig().public.rowLimitCheck === "throw" ? "throw" : "warn";
  globalThis.fetch = rowLimitFetch(globalThis.fetch, mode);
});
