// Who may use the admin app (docs/design/admin-roles.md). A UX guard only:
// the database decides (admin_role(): an active team member on a session that
// passed the second factor), and every rule and admin function checks it
// again. Signed-out people are sent to /login by the Supabase module.
// - Your own authenticators (/security) are open to team members, invited
//   or active, with or without a role yet: an invited member sets them up
//   before joining. They show nothing but that person's own; without a
//   role, the plain "account" layout, with no admin navigation or
//   notifications. Anyone else is turned away. The second step
//   (/security/verify) is open to anyone signed in: it only asks for a code
//   from their own authenticator.
// - Everything else needs a role. A signed-in person with an authenticator
//   who hasn't passed the second step goes to it first; a team member
//   (invited or active) with no authenticator yet goes to set one up;
//   anyone else is told the account doesn't have admin access.
// - If a check itself fails (an error, not an answer), /access-check says
//   so and offers to try again, rather than calling it "no access".
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/login" || to.path === "/confirm" || to.path === "/access-check" || to.path === "/security/verify") return;
  // The session itself, not useSupabaseUser(): straight after the emailed
  // code, the login page moves on before that user is filled in, and this
  // guard let the page open without the second step (found 2026-10-18; the
  // database refused its reads).
  const supabase = useSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const couldNotCheck = () => navigateTo({ path: "/access-check", query: { to: to.fullPath } });
  const { data: role, error: roleError } = await supabase.rpc("admin_role");
  if (roleError) return couldNotCheck();
  if (role) {
    if (to.path === "/security") setPageLayout("default");
    return;
  }

  // A team row that isn't removed (the only one the rules let them read).
  const { data: member, error: memberError } = await supabase.from("admin_members").select("status").neq("status", "removed").maybeSingle();
  if (memberError) return couldNotCheck();
  if (to.path === "/security") {
    if (!member) return navigateTo("/login?denied=1");
    setPageLayout("account");
    return;
  }

  // Worked out from the session itself, without asking the server.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal1" && aal.nextLevel === "aal2") {
    return navigateTo({ path: "/security/verify", query: { to: to.fullPath } });
  }
  // No authenticator yet: for a team member, setting one up comes first.
  if (aal?.nextLevel === "aal1" && member) return navigateTo({ path: "/security", query: { setup: "1" } });
  return navigateTo("/login?denied=1");
});
