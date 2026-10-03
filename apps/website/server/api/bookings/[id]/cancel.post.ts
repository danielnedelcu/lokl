import { z } from "zod";
import { serverSupabaseClient, serverSupabaseServiceRole } from "#supabase/server";

// POST /api/bookings/:id/cancel: the customer cancels (by the policy:
// customerCancelOutcome in @repo/types), or the provider cancels a confirmed
// booking with a reason the customer sees (always a full refund). Who's
// asking decides which: the booking is read through the caller's own client
// (RLS), then matched to them as its customer or its provider.
const body = z.object({ reason: z.string().trim().min(5, "Say why you're cancelling. The customer sees it.").max(1000).optional() });

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const id = getRouterParam(event, "id")!;
  const { data: b } = await (await serverSupabaseClient(event))
    .from("bookings").select("id, customer_id, provider_id").eq("id", id).maybeSingle();
  if (!b) throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
  const { reason } = await readValidatedBody(event, body.parse);
  const db = serverSupabaseServiceRole(event);

  if (b.customer_id === user.sub) {
    const result = await answering(() => customerCancel(db, useStripe(), id));
    kickBookingEmails(event, id);
    return { result };
  }
  const provider = await getOwnProvider(event);
  if (provider && provider.id === b.provider_id) {
    // A suspended provider can still cancel their confirmed bookings
    // (providerMay): the customer gets the usual full refund.
    if (!providerMay(provider.status, "cancel_bookings")) throw createError({ statusCode: 403, statusMessage: "This account can't cancel bookings." });
    if (!reason) throw createError({ statusCode: 400, statusMessage: "Say why you're cancelling. The customer sees it." });
    const result = await answering(() => providerCancel(db, useStripe(), id, reason));
    kickBookingEmails(event, id);
    return { result };
  }
  throw createError({ statusCode: 404, statusMessage: "We couldn't find that booking." });
});
