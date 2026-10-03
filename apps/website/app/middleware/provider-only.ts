// Pages that need a business (bookings, listings, payouts): someone signed
// in with no business is sent to their own bookings instead of a page that
// can't load for them (found 2026-10-03). /dashboard and its settings page
// stay open: that's where a business is set up. Uses the shared "provider"
// fetch when it's already loaded.
import type { Provider } from "@repo/types";

export default defineNuxtRouteMiddleware(async () => {
  if (!useSupabaseUser().value) return; // the Supabase module sends them to sign in
  const cached = useNuxtData<Provider | null>("provider").data.value;
  const provider = cached !== undefined
    ? cached
    : await useRequestFetch()<Provider | null>("/api/provider").catch(() => undefined);
  // Only a definite "no business" redirects; a failed check leaves the page to say so.
  if (provider === null) return navigateTo("/account/bookings", { replace: true });
});
