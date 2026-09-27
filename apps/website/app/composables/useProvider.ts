import type { Provider } from "@repo/types";

// The signed-in user's provider record, shared across dashboard pages.
export function useProvider() {
  return useFetch<Provider | null>("/api/provider", {
    key: "provider",
    headers: useRequestHeaders(["cookie"]),
  });
}
