// Where to go after sign-in, decided once (useSignInConfirm). The signed-in
// user changes more than once while signing in (the session, then its claims),
// and reading the saved address clears it; reacting to every change sent the
// second one to the fallback, so "Sign in to book" landed on /dashboard
// instead of the listing (found 2026-10-01).
export function createSignInRedirect(options: {
  /** Reads the saved address and clears it (useSupabaseCookieRedirect().pluck). */
  takeSaved: () => string | null | undefined;
  fallback: string;
  go: (path: string) => unknown;
}) {
  let target: string | null = null;
  return {
    /** Call whenever the user changes; navigates the first time there's one, and never again. */
    onUser(user: unknown) {
      if (!user || target) return;
      const saved = options.takeSaved();
      // Only a path on this site: never somewhere else via a crafted cookie.
      target = saved && saved.startsWith("/") && !saved.startsWith("//") ? saved : options.fallback;
      options.go(target);
    },
    get target() {
      return target;
    },
  };
}
