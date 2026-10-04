import type { Provider } from "@repo/types";

// The signed-in user's provider record, shared across dashboard pages.
export function useProvider() {
  return useFetch<Provider | null>("/api/provider", {
    key: "provider",
    headers: useRequestHeaders(["cookie"]),
  });
}

/**
 * The same record on public pages, where the visitor may be signed out, and
 * may sign in without leaving the page (the sign-in dialog): fetched only
 * while signed in, and again when the person signing in changes.
 */
export async function useOwnProvider() {
  const user = useSupabaseUser();
  const result = await useFetch<Provider | null>("/api/provider", {
    key: "provider",
    headers: useRequestHeaders(["cookie"]),
    immediate: !!user.value,
  });
  if (import.meta.client) {
    watch(() => user.value?.sub, (id) => {
      if (id) void result.refresh();
      else result.data.value = null;
    });
  }
  return result;
}
