// The owner's invitation (admin roles, step 5a; docs/design/admin-roles.md,
// Joining). The admin app has no server key for Supabase's admin API, so
// the invitation comes here, like the admin's Stripe actions:
//
// 1. Make sure the person has a login: Supabase's admin API creates one,
//    already confirmed, so they can sign in with an emailed code. An email
//    that already has a login keeps it (a customer's, a former member's).
// 2. admin_invite(), as the owner's session (the server key naming it):
//    the database checks the owner, refuses a login that owns a business,
//    logs it, and queues the invitation and the owners' alerts.
//
// Plain TypeScript with no Nuxt imports, so supabase/tests/app/admin-team.test.mts
// runs it against the local stack.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminRole } from "@repo/types";
import { BookingError } from "./bookings";

export async function inviteToTeam(
  db: SupabaseClient,
  adminId: string,
  input: { email: string; role: AdminRole; reason: string },
): Promise<string> {
  const { error: createError } = await db.auth.admin.createUser({ email: input.email, email_confirm: true });
  if (createError && (createError as { code?: string }).code !== "email_exists") {
    throw new Error(`Couldn't make a login for the invitation: ${createError.message}`);
  }
  const { data, error } = await db.rpc("admin_invite", {
    p_admin_id: adminId, p_email: input.email, p_role: input.role, p_reason: input.reason,
  });
  if (error) {
    if (error.code === "42501") throw new BookingError(error.message, 403);
    if (error.code === "23514") throw new BookingError(error.message, 400);
    if (error.code === "P0002") throw new BookingError(error.message, 404);
    throw new Error(error.message);
  }
  return data as string;
}
