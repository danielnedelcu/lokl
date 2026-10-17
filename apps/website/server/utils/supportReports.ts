import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPPORT_LIMIT_MESSAGES, SUPPORT_LIMIT_REPORTS, type Database, type SupportReportInput } from "@repo/types";

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

/** The database's refusal as the provider should see it. */
function refusal(error: { message: string; code?: string }): SupportError {
  if (error.message === SUPPORT_LIMIT_REPORTS || error.message === SUPPORT_LIMIT_MESSAGES) return new SupportError(error.message, 429);
  // A check the provider can fix ("That listing isn't one of yours.").
  if (error.code === "23514") return new SupportError(error.message, 400);
  if (error.code === "42501") return new SupportError("That report isn't yours.", 403);
  console.error("[support] database", error.code);
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
