// Admins are team members (admin_members; docs/design/admin-roles.md), read
// live by the database's admin_role(): an active member on a session that
// passed the second factor. Nothing here reads a role from the sign-in token,
// so removing someone ends their access at once. Providers are identified by
// owning a `providers` row.

export type AdminRole = "owner" | "support";

/** The request header in which lokl's server names the admin session it acts for (admin_role_of()). */
export const ADMIN_SESSION_HEADER = "x-lokl-admin-session";

/**
 * The claims of a Supabase access token **already verified** (getUser or
 * getClaims): who, which session, and whether it passed the second factor.
 * Never use it to trust an unverified token.
 */
export function tokenClaims(token: string): { sub?: string; session_id?: string; aal?: string } {
  try {
    const b64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// The admin's second factor: an authenticator app (docs/design/admin-roles.md)
// ---------------------------------------------------------------------------

/**
 * Whether admin access requires a second factor: true since the admin roles
 * migration (cutover step 4), which makes the database refuse sessions that
 * haven't passed it; so removing your last authenticator is refused rather
 * than warned about.
 */
export const ADMIN_MFA_REQUIRED = true;

/** How an authenticator app lists lokl's entry (Supabase uses the site's address otherwise, "localhost" locally). */
export const AUTHENTICATOR_ISSUER = "lokl admin";

/** The longest name a person can give an authenticator ("Phone", "Password manager"). */
export const AUTHENTICATOR_NAME_MAX = 40;

/** A name for a new authenticator: required, short, and not one they already use (Supabase requires unique names). */
export function authenticatorNameProblem(name: string, taken: string[]): string | null {
  const n = name.trim();
  if (!n) return "Give it a name, such as Phone or Password manager.";
  if (n.length > AUTHENTICATOR_NAME_MAX) return `Keep the name under ${AUTHENTICATOR_NAME_MAX} characters.`;
  if (taken.some((t) => t.trim().toLowerCase() === n.toLowerCase())) return "You already have an authenticator with that name.";
  return null;
}

/** An authenticator's key in groups of four, easier to read and type: "ABCD EFGH IJKL …". */
export function groupedKey(secret: string): string {
  return secret.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? "";
}

/**
 * Removing one of your authenticators: refused if it's your last and they're
 * required; otherwise allowed, with a warning when it's your last.
 */
export function authenticatorRemoval(verifiedCount: number, required = ADMIN_MFA_REQUIRED): { allowed: boolean; warning: string | null } {
  const last = verifiedCount <= 1;
  if (last && required) return { allowed: false, warning: "This is your only authenticator, and admin access needs one. Add another before removing this one." };
  if (last) return { allowed: true, warning: "This is your only authenticator. Without one, you'll sign in with the emailed code alone, and admin access will soon require an authenticator." };
  return { allowed: true, warning: null };
}
