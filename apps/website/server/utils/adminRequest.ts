// Admin calls from the admin app to the website (decision 14,
// docs/design/booking-and-checkout.md, "Admin actions on the website").
// The admin app has no Stripe key, so its refunds and cancellations call
// /api/admin/* here, across sites, and each call is checked in this order:
//
// 1. The Origin header is exactly the admin app's (NUXT_ADMIN_ORIGIN), or
//    the request is refused before the token is looked at.
// 2. The admin's own Supabase token is sent explicitly
//    (Authorization: Bearer ...): no cookies cross between the apps.
// 3. Supabase verifies the token (getUser, not just decoding it), and the
//    user must be an admin (app_metadata.role).
//
// checkAdminRequest is plain TypeScript, so supabase/tests/app/admin-request.test.mts
// runs it with real tokens from the local stack; requireAdminRequest is the
// routes' wrapper.

import { isAdmin } from "@repo/types";

export type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; message: string };

export async function checkAdminRequest(
  req: { origin: string | undefined; authorization: string | undefined },
  deps: { adminOrigin: string; getUser: (token: string) => Promise<{ id: string; app_metadata?: Record<string, unknown> } | null> },
): Promise<AdminCheck> {
  if (!deps.adminOrigin || req.origin !== deps.adminOrigin) {
    return { ok: false, status: 403, message: "This can only be done from the lokl admin app." };
  }
  const token = /^Bearer (\S+)$/.exec(req.authorization ?? "")?.[1];
  if (!token) return { ok: false, status: 401, message: "Sign in required" };
  const user = await deps.getUser(token).catch(() => null);
  if (!user) return { ok: false, status: 401, message: "Your sign-in has expired. Sign in again." };
  if (!isAdmin(user)) return { ok: false, status: 403, message: "Admins only" };
  return { ok: true, userId: user.id };
}
