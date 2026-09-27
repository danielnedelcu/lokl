import { providerProfileSchema } from "@repo/types";
import { serverSupabaseClient } from "#supabase/server";

// Creates or updates the signed-in user's business profile.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  // Same schema as the business profile form, validated again here.
  const input = await readValidatedBody(event, providerProfileSchema.parse);
  const supabase = await serverSupabaseClient(event);
  const existing = await getOwnProvider(event);

  // The picker only offers active cities, but check here too: the database
  // would accept any city id. RLS returns active cities only to this client.
  const { data: city, error: cityError } = await supabase
    .from("cities")
    .select("id")
    .eq("id", input.city_id)
    .maybeSingle();
  if (cityError) throw createError({ statusCode: 500, statusMessage: cityError.message });
  if (!city) throw createError({ statusCode: 400, statusMessage: "Choose one of the listed cities." });

  const query = existing
    ? supabase.from("providers").update(input).eq("id", existing.id)
    : supabase.from("providers").insert({ ...input, owner_id: user.sub });

  const { data, error } = await query.select("*").single();
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  return data;
});
