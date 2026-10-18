import { isAdmin } from "@repo/types";

// Signed-in users who aren't admins get bounced. The Supabase module already
// sends signed-out users to /login. This is a UX guard only: real enforcement
// lives in Supabase RLS policies and in server routes via requireAdmin().
// An admin who has set up an authenticator and signed in with the emailed
// code only is sent to the second step first (docs/design/admin-roles.md;
// optional for those with none, until the admin roles migration).
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/login" || to.path === "/confirm" || to.path === "/security/verify") return;

  const user = useSupabaseUser();
  if (user.value && !isAdmin(user.value)) {
    return navigateTo("/login?denied=1");
  }
  if (user.value) {
    // Worked out from the session itself, without asking the server.
    const { data } = await useSupabaseClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel === "aal1" && data.nextLevel === "aal2") {
      return navigateTo({ path: "/security/verify", query: { to: to.fullPath } });
    }
  }
});
