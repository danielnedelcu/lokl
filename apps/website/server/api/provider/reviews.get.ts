import { serverSupabaseServiceRole } from "#supabase/server";

// GET /api/provider/reviews: the signed-in provider's reviews, with the
// booking each is for (so the page links to where they reply) and whether
// they've replied (docs/design/reviews.md, Provider replies). Unreplied
// published reviews first, then newest. The booking id isn't readable
// through the API (reviews' column grants), so this reads with the server
// key, only for the provider's own reviews, after the check below.
export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event, "view_bookings");
  const { data, error } = await serverSupabaseServiceRole(event)
    .from("reviews")
    .select("id, booking_id, rating, body, reviewer_name, booking_month, created_at, edited_at, status, removed_rule, listing:listings(title), reply:review_replies(status)")
    .eq("provider_id", provider.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[provider reviews]", error);
    throw createError({ statusCode: 500, statusMessage: "Your reviews didn't load. Please try again." });
  }
  type Row = {
    id: string; booking_id: string; rating: number; body: string; reviewer_name: string; booking_month: string;
    created_at: string; edited_at: string | null; status: string; removed_rule: string | null;
    listing: { title: string } | null; reply: { status: string } | { status: string }[] | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const reply = Array.isArray(r.reply) ? r.reply[0] ?? null : r.reply;
    return {
      id: r.id, bookingId: r.booking_id, rating: r.rating, body: r.body, reviewerName: r.reviewer_name, bookingMonth: r.booking_month,
      createdAt: r.created_at, editedAt: r.edited_at, status: r.status, removedRule: r.removed_rule,
      listingTitle: r.listing?.title ?? "A listing", replied: reply?.status ?? null,
    };
  });
  const waiting = (r: (typeof rows)[number]) => r.status === "published" && !r.replied;
  return rows.sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
});
