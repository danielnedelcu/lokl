import { z } from "zod";
import { serverSupabaseClient } from "#supabase/server";

const body = z.object({
  display_name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(120).optional().transform((v) => v || null),
});

// Creates or updates the signed-in user's business profile.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const input = await readValidatedBody(event, body.parse);
  const supabase = await serverSupabaseClient(event);
  const existing = await getOwnProvider(event);

  const query = existing
    ? supabase.from("providers").update(input).eq("id", existing.id)
    : supabase.from("providers").insert({ ...input, owner_id: user.sub });

  const { data, error } = await query.select("*").single();
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  return data;
});
