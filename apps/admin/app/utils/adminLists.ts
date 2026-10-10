import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows, type Database } from "@repo/types";
import { ADMIN_BOOKING_FIELDS, withFinances, type AdminBookingRow } from "./bookingAdmin";

// The admin's shorter lists: each shows its latest rows and says how many
// there are in all, so a list cut short says so. Plain TypeScript, so
// supabase/tests/app/admin-lists.test.mts runs this same code.

type Db = SupabaseClient<Database>;
export interface Capped<T> { items: T[]; total: number }

export const FAILED_EMAILS_SHOWN = 100;
export const FAILED_RUNS_SHOWN = 50;
export const LISTING_BOOKINGS_SHOWN = 200;
export const RATE_CHANGES_SHOWN = 50;
export const GUIDE_DRAFTS_SHOWN = 10;
/** The homepage picker reads every published guide; past this many it stops with an error. */
const PUBLISHED_GUIDES_MAX = 20_000;

/** Booking emails that failed, newest first (the Bookings page's "needs attention"). */
export async function failedEmails(supabase: Db): Promise<Capped<any>> {
  const { data, error, count } = await supabase.from("booking_emails").select("id, booking_id, kind, last_error, created_at", { count: "exact" })
    .eq("status", "failed").order("created_at", { ascending: false }).limit(FAILED_EMAILS_SHOWN);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}

/** Job runs since a time that failed, crashed or left work for the next run, newest first. */
export async function failedJobRuns(supabase: Db, since: string): Promise<Capped<any>> {
  const { data, error, count } = await supabase.from("job_runs").select("id, job, finished_at, failed, failures, error, more_waiting", { count: "exact" })
    .gte("finished_at", since).or("failed.gt.0,error.not.is.null,more_waiting.is.true").order("finished_at", { ascending: false }).limit(FAILED_RUNS_SHOWN);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}

/** A listing's bookings, latest first, and how many are confirmed or waiting for an answer. */
export async function listingBookings(supabase: Db, listingId: string): Promise<Capped<AdminBookingRow> & { upcoming: number }> {
  const [list, upcoming] = await Promise.all([
    supabase.from("bookings").select(ADMIN_BOOKING_FIELDS, { count: "exact" })
      .eq("listing_id", listingId).neq("status", "pending_payment").order("starts_at", { ascending: false }).limit(LISTING_BOOKINGS_SHOWN),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("listing_id", listingId).in("status", ["confirmed", "requested"]),
  ]);
  if (list.error) throw list.error;
  if (upcoming.error) throw upcoming.error;
  const items = ((list.data ?? []) as any[]).map((b) => withFinances(b)) as AdminBookingRow[];
  return { items, total: list.count ?? 0, upcoming: upcoming.count ?? 0 };
}

/** Commission rate changes, newest first. */
export async function rateChanges(supabase: Db): Promise<Capped<any>> {
  const { data, error, count } = await supabase.from("commission_rate_changes").select("id, kind, old_rate_bps, new_rate_bps, changed_by, changed_at", { count: "exact" })
    .order("changed_at", { ascending: false }).limit(RATE_CHANGES_SHOWN);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}

/** A guide's AI drafts (the cost log), newest first. */
export async function guideDraftLog(supabase: Db, guideId: string): Promise<Capped<any>> {
  const { data, error, count } = await supabase.from("guide_ai_drafts")
    .select("id, created_at, topic, error, cost_usd, reply, previous_draft, previous_draft_restored_at", { count: "exact" })
    .eq("guide_id", guideId).order("created_at", { ascending: false }).limit(GUIDE_DRAFTS_SHOWN);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}

/** Every published guide, newest content first: the homepage picker chooses among them all. */
export async function publishedGuides(supabase: Db): Promise<any[]> {
  // A page of 1,000 at a time (allRows), ordered by id last so none repeats.
  return allRows((from, to) => supabase.from("guides")
    .select("id, slug, title, teaser, market:cities(slug), cover:guide_photos!guides_cover_fk(id, storage_path, card_path, width, height, alt_text, source, credit_name, credit_url, source_url, licence)")
    .eq("status", "published")
    .order("content_updated_at", { ascending: false })
    .order("id")
    .range(from, to), PUBLISHED_GUIDES_MAX);
}
