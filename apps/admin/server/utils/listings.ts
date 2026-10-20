import type { H3Event } from "h3";
import { listingReasonSchema, errorText } from "@repo/types";

// Listing review (admin roles step 5d): the database does it all, as the
// admin's own session. admin_set_listing_status() checks who's acting,
// that the listing is still where the page saw it, the kind (only
// Experiences are approved) and the reason, logs it and alerts the owners
// when support takes one down; its listings_require_ready trigger refuses
// going live while something blocks it. This turns refusals into answers.

export type ReviewAction = "approve" | "reject" | "unpublish" | "restore";

const MOVES: Record<ReviewAction, { from: string; to: string }> = {
  approve: { from: "submitted", to: "live" },
  reject: { from: "submitted", to: "rejected" },
  unpublish: { from: "live", to: "unpublished" },
  restore: { from: "unpublished", to: "live" },
};

/** Runs one review action for the admin (requireAdmin first). Reject and unpublish take a reason the provider sees. */
export async function reviewListing(event: H3Event, action: ReviewAction) {
  const admin = await requireAdmin(event);
  const reason = action === "reject" || action === "unpublish" ? await readReason(event) : null;
  const id = getRouterParam(event, "id")!;
  const { from, to } = MOVES[action];
  const { error } = await admin.db.rpc("admin_set_listing_status", {
    p_admin_id: admin.sub, p_listing_id: id, p_from: from, p_to: to, p_reason: reason ?? undefined,
  });
  if (!error) return { status: to };
  // The database's sentences are written for the admin: a rule (what's
  // missing, a Service, a reason), a change meanwhile, or no such listing.
  if (error.code === "23514") throw createError({ statusCode: 422, statusMessage: error.message });
  if (error.code === "55000") throw createError({ statusCode: 409, statusMessage: error.message });
  if (error.code === "P0002") throw createError({ statusCode: 404, statusMessage: "We couldn't find that listing." });
  if (error.code === "42501") throw createError({ statusCode: 403, statusMessage: "Only lokl's team can review listings." });
  console.error(`[admin api] ${action} listing failed`, errorText(error));
  throw createError({ statusCode: 500, statusMessage: "Something went wrong on our side. Try again, or check the server logs." });
}

// The reason sent with a rejection or unpublish (listingReasonSchema); the
// provider sees it.
async function readReason(event: H3Event) {
  const parsed = listingReasonSchema.safeParse(await readBody(event).catch(() => null));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? "A reason is required." });
  }
  return parsed.data.reason;
}
