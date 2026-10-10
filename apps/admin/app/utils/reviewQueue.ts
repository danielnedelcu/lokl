import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";

// Experiences waiting for review, oldest first (design: Review queue), a
// page at a time, with how many are waiting. Plain TypeScript, so
// supabase/tests/app/admin-review-queue.test.mts runs this same code.

export const REVIEW_QUEUE_PAGE_SIZE = 50;

export interface ReviewQueueRow {
  id: string;
  title: string;
  submitted_at: string | null;
  provider: { display_name: string } | null;
  category: { name: string } | null;
}

export async function reviewQueuePage(supabase: SupabaseClient<Database>, page = 1): Promise<{ items: ReviewQueueRow[]; total: number }> {
  // Counted and paged by the database (counting rows read here stopped at
  // the API's 1,000); ordered by id last so pages never repeat a row.
  const p = Math.max(1, page);
  const { data, error, count } = await supabase
    .from("listings")
    .select("id, title, submitted_at, provider:providers(display_name), category:categories(name)", { count: "exact" })
    .eq("kind", "experience")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true, nullsFirst: true })
    .order("id")
    .range((p - 1) * REVIEW_QUEUE_PAGE_SIZE, p * REVIEW_QUEUE_PAGE_SIZE - 1);
  if (error) throw error;
  return { items: data as unknown as ReviewQueueRow[], total: count ?? 0 };
}
