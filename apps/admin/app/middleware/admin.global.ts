import type { AdminRole } from "@repo/types";

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
// - Owner-only pages (definePageMeta({ ownerOnly: true }): guides, the
//   homepage, categories, markets, settings, the team) send support to
//   /owner-only, which says so. The role is kept (useAdminRole) for the
//   menu.
// - An invited member who has passed the second step goes to /join, to
//   join the team (admin_join()); /join is open to invited members only.
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
  useAdminRole().value = (role as AdminRole | null) ?? null;
  if (role) {
    if (to.path === "/security") setPageLayout("default");
    if (to.path === "/join") return navigateTo("/");
    if (to.meta.ownerOnly && role !== "owner") return navigateTo({ path: "/owner-only", query: { page: to.path } });
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
  // Invited, and past the second step: joining is the one thing left.
  const invitedAndVerified = member?.status === "invited" && aal?.currentLevel === "aal2";
  if (to.path === "/join") {
    if (!invitedAndVerified) return navigateTo(member ? "/" : "/login?denied=1");
    setPageLayout("account");
    return;
  }
  if (invitedAndVerified) return navigateTo("/join");
  if (aal?.currentLevel === "aal1" && aal.nextLevel === "aal2") {
    return navigateTo({ path: "/security/verify", query: { to: to.fullPath } });
  }
  // No authenticator yet: for a team member, setting one up comes first.
  if (aal?.nextLevel === "aal1" && member) return navigateTo({ path: "/security", query: { setup: "1" } });
  return navigateTo("/login?denied=1");
});
