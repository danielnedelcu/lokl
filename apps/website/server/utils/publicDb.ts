import type { ServerEvent } from "./provider";

// The signed-out client for public routes, built from the site's public
// Supabase settings. It never sees the visitor's cookies, so a signed-in
// provider gets exactly what a stranger gets: never their own drafts.
export function usePublicDb(_event: ServerEvent) {
  const { url, key } = useRuntimeConfig().public.supabase;
  return publicSupabase(url, key);
}

// A plain failure for public pages; the detail goes to the server log.
export function publicFailure(error: unknown) {
  console.error("[public api]", error);
  return createError({ statusCode: 500, statusMessage: "Something went wrong. Please try again in a moment." });
}
