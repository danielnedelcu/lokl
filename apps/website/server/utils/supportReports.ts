import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPPORT_LIMIT_MESSAGES, SUPPORT_LIMIT_REPORTS, logText, type Database, type SupportReportInput, type SupportStatus } from "@repo/types";

// A provider's problem reports (docs/design/problem-reports.md): written with
// their own client, so the database's rules decide (their own business,
// listing, booking and report; the limits; "This is sorted" never on a
// Safety report). Plain TypeScript, so the app tests run this same code.

/** A refusal the provider can act on: the database's own words, and an HTTP status. */
export class SupportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };

/**
 * An unexpected database error, logged in full on the server (its code and
 * words, through logText: no keys or contact details) before the person is
 * shown the plain "That didn't…" message. Never only the generic message:
 * a missing function (a migration not yet on the database) must be visible.
 */
export function logSupportError(where: string, error: DbError) {
  const parts = [error.code ?? "no code", error.message, error.details, error.hint].filter(Boolean).join(" | ");
  console.error(`[support] ${where}: ${logText(parts, 1000)}`);
}

/** The database's refusal as the provider should see it. */
function refusal(error: DbError): SupportError {
  if (error.message === SUPPORT_LIMIT_REPORTS || error.message === SUPPORT_LIMIT_MESSAGES) return new SupportError(error.message, 429);
  // A check the provider can fix ("That listing isn't one of yours.").
  if (error.code === "23514") return new SupportError(error.message, 400);
  if (error.code === "42501") {
    // Usually someone else's report; logged too, in case it's a missing grant.
    logSupportError("provider refused", error);
    return new SupportError("That report isn't yours.", 403);
  }
  logSupportError("provider", error);
  return new SupportError("That didn't go through. Please try again.", 500);
}

/** Sends a report as the provider's business; its id. */
export async function createSupportReport(db: SupabaseClient<Database>, input: SupportReportInput): Promise<string> {
  const { data, error } = await db.from("support_reports").insert({
    category: input.category,
    description: input.description.trim(),
    listing_id: input.listingId ?? null,
    booking_id: input.bookingId ?? null,
    follows_report_id: input.followsReportId ?? null,
  }).select("id").single();
  if (error) throw refusal(error);
  return data.id;
}

/** Adds the provider's reply to their report. */
export async function addProviderMessage(db: SupabaseClient<Database>, reportId: string, body: string): Promise<void> {
  const { data, error } = await db.from("support_messages").insert({ report_id: reportId, body: body.trim() }).select("id");
  if (error) throw refusal(error);
  if (!data?.length) throw new SupportError("That report isn't yours.", 403);
}

/** "This is sorted": the provider closes their own report (never a Safety one). */
export async function markSupportReportSorted(db: SupabaseClient<Database>, reportId: string): Promise<void> {
  const { data, error } = await db.from("support_reports").update({ status: "done" }).eq("id", reportId).select("id");
  if (error) throw refusal(error);
  // Nothing changed: not theirs (their read rule hides it).
  if (!data?.length) throw new SupportError("That report isn't yours.", 403);
}

// ---------------------------------------------------------------------------
// The admin's side (phase 3): the admin routes call these with the server
// key, after requireAdminRequest. Each is one database function that makes
// the change and logs it in admin_actions, refusing a login that isn't an
// admin and a move from a column the report has left.
// ---------------------------------------------------------------------------

/** The admin functions' refusals, in their own words. */
function adminRefusal(error: DbError): SupportError {
  if (error.code === "P0002") return new SupportError(error.message, 404);
  if (error.code === "23514") return new SupportError(error.message, 409);
  if (error.code === "42501") {
    logSupportError("admin refused", error);
    return new SupportError("Admins only.", 403);
  }
  logSupportError("admin", error);
  return new SupportError("That didn't save. Please try again.", 500);
}

/** lokl's reply; with `wait`, the report also moves to Waiting on provider. Its status after. */
export async function adminReply(db: SupabaseClient<Database>, reportId: string, adminId: string, body: string, wait: boolean): Promise<SupportStatus> {
  const { data, error } = await db.rpc("admin_support_reply", { p_report_id: reportId, p_admin_id: adminId, p_body: body.trim(), p_wait: wait });
  if (error) throw adminRefusal(error);
  return data as SupportStatus;
}

/** "Move to…": from the column the admin saw it in, to another. */
export async function adminMove(db: SupabaseClient<Database>, reportId: string, adminId: string, to: SupportStatus, from: SupportStatus | null): Promise<SupportStatus> {
  const { data, error } = await db.rpc("admin_support_move", { p_report_id: reportId, p_admin_id: adminId, p_to: to, p_from: from ?? undefined });
  if (error) throw adminRefusal(error);
  return data as SupportStatus;
}

/** A private note; its id. */
export async function adminNote(db: SupabaseClient<Database>, reportId: string, adminId: string, body: string): Promise<string> {
  const { data, error } = await db.rpc("admin_support_note", { p_report_id: reportId, p_admin_id: adminId, p_body: body.trim() });
  if (error) throw adminRefusal(error);
  return data as string;
}
