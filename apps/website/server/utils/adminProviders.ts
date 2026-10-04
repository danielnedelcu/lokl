import type { SupabaseClient } from "@supabase/supabase-js";
import { PROFILE_RULES } from "@repo/types";
import { BookingError } from "./bookings";
import { requireReason } from "./adminBookings";

// The admin's removal of profile content that breaks a profile rule
// (docs/design/provider-profiles.md, The admin and Profile rules). One
// database function does the change, the log and the provider's email in a
// single transaction; the removed photos' files are deleted after.

const PARTS = ["avatar", "cover", "headline", "bio"] as const;
export type ProfilePart = (typeof PARTS)[number];

export async function removeProfileContent(
  db: SupabaseClient, providerId: string, adminId: string,
  input: { parts: string[]; rule: string; reason: string; message?: string | null },
) {
  const reason = requireReason(input.reason);
  const parts = [...new Set(input.parts)].filter((p): p is ProfilePart => (PARTS as readonly string[]).includes(p));
  if (!parts.length) throw new BookingError("Choose what to remove: the profile photo, cover photo, headline or bio.", 400);
  if (!(input.rule in PROFILE_RULES)) throw new BookingError("Choose the profile rule this content breaks.", 400);
  const message = (input.message ?? "").trim().slice(0, 1000) || null;
  const { data: files, error } = await db.rpc("admin_remove_provider_profile_content", {
    p_provider_id: providerId, p_admin_id: adminId, p_parts: parts, p_rule: input.rule, p_reason: reason, p_message: message,
  });
  if (error) {
    if (error.code === "P0002") throw new BookingError("We couldn't find that provider.", 404);
    if (error.code === "23514") throw new BookingError(error.message, 400);
    throw new Error(error.message);
  }
  // The rows no longer point at them; a file left behind is only clutter.
  const paths = (files as string[] | null) ?? [];
  if (paths.length) await db.storage.from("provider-photos").remove(paths);
  return `removed: ${parts.join(", ")}`;
}
