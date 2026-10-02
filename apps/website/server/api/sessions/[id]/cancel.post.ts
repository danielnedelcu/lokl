import { z } from "zod";
import { serverSupabaseClient, serverSupabaseServiceRole } from "#supabase/server";

// POST /api/sessions/:id/cancel { reason }: the provider cancels a session
// that has bookings. Everyone on it is refunded in full and sees the reason
// (decision 12). A session with no bookings is simply deleted from the page
// instead. The session is read through the provider's own client (RLS), then
// matched to their business.
const body = z.object({ reason: z.string().trim().min(5, "Say why you're cancelling. Customers see it.").max(1000) });

export default defineEventHandler(async (event) => {
  const provider = await requireProvider(event);
  const id = getRouterParam(event, "id")!;
  const { data: s } = await (await serverSupabaseClient(event))
    .from("experience_sessions").select("id, status, starts_at, listing:listings(provider_id)").eq("id", id).maybeSingle();
  const owner = (s?.listing as { provider_id: string } | null)?.provider_id;
  if (!s || owner !== provider.id) throw createError({ statusCode: 404, statusMessage: "We couldn't find that session." });
  if (Date.parse(s.starts_at) <= Date.now()) throw createError({ statusCode: 409, statusMessage: "This session has started, so it can't be cancelled." });
  const { reason } = await readValidatedBody(event, body.parse);
  const done = await answering(() => cancelSession(serverSupabaseServiceRole(event), useStripe(), id, reason));
  kickBookingEmails(event);
  return { cancelled: done.length, done };
});
