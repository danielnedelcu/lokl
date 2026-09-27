import { isAdmin } from "@repo/types";

// Signed-in users who aren't admins get bounced. The Supabase module already
// sends signed-out users to /login. This is a UX guard only: real enforcement
// lives in Supabase RLS policies and in server routes via requireAdmin().
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/login" || to.path === "/confirm") return;

  const user = useSupabaseUser();
  if (user.value && !isAdmin(user.value)) {
    return navigateTo("/login?denied=1");
  }
});
