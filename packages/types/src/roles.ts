// Admins are marked with `app_metadata.role = "admin"` on their Supabase user.
// app_metadata can only be written with the service role key, so users cannot
// promote themselves. Providers are identified by owning a `providers` row.
export function isAdmin(user: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}
