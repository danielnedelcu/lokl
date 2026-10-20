import type { SupabaseClient } from "@supabase/supabase-js";
import { errorText, PROFILE_PARTS, PROFILE_RULES, rpcJson, type ProfilePart } from "@repo/types";
import { BookingError } from "./bookings";
import { requireReason } from "./adminBookings";

// Profile content that breaks a profile rule (docs/design/provider-profiles.md,
// The admin; docs/design/admin-roles.md, step 5e). The database does each
// change, its log and the provider's email in one transaction:
// - support (or the owner) hides parts (admin_hide_profile_content): kept in
//   a hold, off the profile at once; a hidden photo's files then move from
//   the public bucket into the private provider-photos-held;
// - the owner decides (admin_decide_profile_hold): confirm the removal (the
//   hidden version is deleted), restore it, or dismiss it once replaced;
// - the owner may still remove outright (admin_remove_provider_profile_content).
// Files move after the database commits; each step's outcome is recorded
// (admin_profile_hold_files), and one that fails is tried again on the next
// profile action or from the queue's "Try again".

export const PUBLIC_BUCKET = "provider-photos";
export const HELD_BUCKET = "provider-photos-held";

function parse(input: { parts: string[]; rule: string; reason: string; message?: string | null }, verb: string) {
  const reason = requireReason(input.reason);
  const parts = [...new Set(input.parts)].filter((p): p is ProfilePart => (PROFILE_PARTS as readonly string[]).includes(p));
  if (!parts.length) throw new BookingError(`Choose what to ${verb}: the profile photo, cover photo, headline or bio.`, 400);
  if (!(input.rule in PROFILE_RULES)) throw new BookingError("Choose the profile rule this content breaks.", 400);
  const message = (input.message ?? "").trim().slice(0, 1000) || null;
  return { reason, parts, message };
}

function refusal(error: { code?: string; message: string }): never {
  if (error.code === "P0002") throw new BookingError(error.message === "No such provider." ? "We couldn't find that provider." : "We couldn't find that hidden content.", 404);
  if (error.code === "23514") throw new BookingError(error.message, 400);
  if (error.code === "42501") throw new BookingError(error.message, 403);
  if (error.code === "55000") throw new BookingError(error.message, 409);
  throw new Error(error.message);
}

/** The owner removes parts outright; the database refuses support. Files are deleted after. */
export async function removeProfileContent(
  db: SupabaseClient, providerId: string, adminId: string,
  input: { parts: string[]; rule: string; reason: string; message?: string | null },
) {
  const { reason, parts, message } = parse(input, "remove");
  const { data: files, error } = await db.rpc("admin_remove_provider_profile_content", {
    p_provider_id: providerId, p_admin_id: adminId, p_parts: parts, p_rule: input.rule, p_reason: reason, p_message: message,
  });
  if (error) refusal(error);
  // The rows no longer point at them; a file left behind is only clutter.
  const paths = (files as string[] | null) ?? [];
  if (paths.length) await db.storage.from(PUBLIC_BUCKET).remove(paths);
  return `removed: ${parts.join(", ")}`;
}

/** Support or the owner hides parts: off the profile at once; the photos' files then leave the public bucket. */
export async function hideProfileContent(
  db: SupabaseClient, providerId: string, adminId: string,
  input: { parts: string[]; rule: string; reason: string; message?: string | null },
) {
  const { reason, parts, message } = parse(input, "hide");
  const { data, error } = await db.rpc("admin_hide_profile_content", {
    p_admin_id: adminId, p_provider_id: providerId, p_parts: parts, p_rule: input.rule, p_reason: reason, p_message: message,
  });
  if (error) refusal(error);
  // The photos to move are also recorded on their holds, which settleHeldFiles reads.
  const moves = rpcJson("admin_hide_profile_content", data);
  const unsettled = moves.length ? await settleHeldFiles(db) : 0;
  return unsettled ? `hidden: ${parts.join(", ")}; a photo's files are still public (try again from the queue)` : `hidden: ${parts.join(", ")}`;
}

/** The owner decides: remove (confirm), restore, or dismiss (only once they've replaced it). */
export async function decideProfileHold(db: SupabaseClient, holdId: string, adminId: string, input: { decision: string; note?: string | null }) {
  const note = (input.note ?? "").trim().slice(0, 1000) || null;
  const { data, error } = await db.rpc("admin_decide_profile_hold", { p_admin_id: adminId, p_hold_id: holdId, p_decision: input.decision, p_note: note });
  if (error) refusal(error);
  // Files to move back or delete are also recorded on the hold.
  if (rpcJson("admin_decide_profile_hold", data)) await settleHeldFiles(db);
  return input.decision === "restore" ? "restored" : input.decision === "dismiss" ? "dismissed" : "removed";
}

const notFound = (e: { message?: string; statusCode?: string | number } | null) =>
  !!e && (String(e.statusCode) === "404" || /not.?found/i.test(e.message ?? ""));

/**
 * Moves or deletes the files of every hold whose files are on their way
 * (moving, restoring, deleting), and records each outcome. Safe to repeat:
 * a file already where it should be counts as done. Returns how many are
 * still unsettled (a storage error), for the caller to say so.
 */
export async function settleHeldFiles(db: SupabaseClient): Promise<number> {
  const { data: holds, error } = await db.from("provider_profile_holds")
    .select("id, files, public_paths, held_paths")
    .in("files", ["moving", "restoring", "deleting"])
    // bounded: only holds whose files are mid-move, a handful at most
    .limit(50);
  if (error) {
    console.error("[admin api] couldn't read the holds' files", errorText(error));
    return 1;
  }
  let unsettled = 0;
  for (const h of (holds ?? []) as { id: string; files: string; public_paths: string[]; held_paths: string[] }[]) {
    try {
      const outcome = h.files === "moving" ? await moveAll(db, PUBLIC_BUCKET, h.public_paths, HELD_BUCKET, h.held_paths)
        : h.files === "restoring" ? await moveAll(db, HELD_BUCKET, h.held_paths, PUBLIC_BUCKET, h.public_paths)
        : await deleteAll(db, h);
      const next = h.files === "moving" ? (outcome === "missing" ? "missing" : "private") : h.files === "restoring" ? "public" : "deleted";
      if (outcome === "missing" && h.files === "restoring") throw new Error("the held files are gone");
      const { error: e } = await db.rpc("admin_profile_hold_files", { p_hold_id: h.id, p_files: next });
      if (e) throw e;
    } catch (e) {
      unsettled++;
      console.error(`[admin api] hold ${h.id}: its files didn't settle`, errorText(e));
    }
  }
  return unsettled;
}

async function moveAll(db: SupabaseClient, fromBucket: string, from: string[], toBucket: string, to: string[]): Promise<"moved" | "missing"> {
  let moved = 0;
  for (const [i, path] of from.entries()) {
    const { error } = await db.storage.from(fromBucket).move(path, to[i]!, { destinationBucket: toBucket });
    if (!error) {
      moved++;
      continue;
    }
    if (!notFound(error)) throw error;
    // Gone from where it was: already moved by an earlier try, or deleted.
    const { data: there } = await db.storage.from(toBucket).exists(to[i]!);
    if (there) moved++;
  }
  return moved ? "moved" : "missing";
}

async function deleteAll(db: SupabaseClient, h: { held_paths: string[]; public_paths: string[] }) {
  // Wherever they are now: kept in the held bucket, or never moved.
  for (const [bucket, paths] of [[HELD_BUCKET, h.held_paths], [PUBLIC_BUCKET, h.public_paths]] as const) {
    const { error } = await db.storage.from(bucket).remove([...paths]);
    if (error && !notFound(error)) throw error;
  }
  return "deleted" as const;
}
