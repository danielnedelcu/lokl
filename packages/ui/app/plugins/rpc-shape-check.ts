import { setRpcShapeCheck } from "@repo/types";

// The pages' check of database functions' JSON (rpcJson in @repo/types), on
// the server while rendering and in the browser: "throw" in the test apps,
// "warn" otherwise (runtimeConfig.public.rpcShapeCheck). Server routes get
// theirs from server/plugins/row-limit-check.ts.
export default defineNuxtPlugin({
  name: "rpc-shape-check",
  enforce: "pre",
  setup() {
    setRpcShapeCheck(useRuntimeConfig().public.rpcShapeCheck === "throw" ? "throw" : "warn");
  },
});
