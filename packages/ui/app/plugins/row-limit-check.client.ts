import { rowLimitFetch } from "@repo/types";

// The browser's API reads, checked for a read cut off at the API's 1,000
// rows (rowLimitFetch in @repo/types). "pre", so it wraps fetch before the
// Supabase client is made. The mode is runtimeConfig.public.rowLimitCheck.
export default defineNuxtPlugin({
  name: "row-limit-check",
  enforce: "pre",
  setup() {
    const mode = useRuntimeConfig().public.rowLimitCheck === "throw" ? "throw" : "warn";
    window.fetch = rowLimitFetch(window.fetch.bind(window), mode);
  },
});
