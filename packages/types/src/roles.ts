// Admins are marked with `app_metadata.role = "admin"` on their Supabase user.
// app_metadata can only be written with the service role key, so users cannot
// promote themselves. Providers are identified by owning a `providers` row.
export function isAdmin(user: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}

// ---------------------------------------------------------------------------
// The admin's second factor: an authenticator app (docs/design/admin-roles.md)
// ---------------------------------------------------------------------------

/**
 * Whether admin access requires a second factor yet. False until the admin
 * roles migration (cutover step 4) makes the database refuse sessions that
 * haven't passed it; then removing your last authenticator is refused rather
 * than warned about.
 */
export const ADMIN_MFA_REQUIRED = false;

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
