import { retryReadsFetch, rowLimitFetch, setRpcShapeCheck } from "@repo/types";

// Every server-side API read in both apps goes through the global fetch
// (Supabase clients pick it up when they're made, per request), so wrapping
// it checks them all for a read cut off at the API's 1,000 rows. See
// rowLimitFetch in @repo/types; the mode is runtimeConfig.public.rowLimitCheck.
// Inside it, a read that met a gateway error (502, 503) is asked again once
// (retryReadsFetch: GET and HEAD, and the listed search reads; never a write).
// Also the server routes' check of database functions' JSON (rpcJson), whose
// mode is runtimeConfig.public.rpcShapeCheck.
export default defineNitroPlugin(() => {
  const config = useRuntimeConfig().public;
  globalThis.fetch = rowLimitFetch(retryReadsFetch(globalThis.fetch), config.rowLimitCheck === "throw" ? "throw" : "warn");
  setRpcShapeCheck(config.rpcShapeCheck === "throw" ? "throw" : "warn");
});
