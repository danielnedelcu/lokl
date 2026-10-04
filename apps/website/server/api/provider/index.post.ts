import { providerProfileSchema, type Database } from "@repo/types";
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

  // The public profile's text: blank means none. (The database refuses
  // contact details too, as a backstop to the schema's check.)
  const profile = { headline: input.headline || null, bio: input.bio || null };
  const base = { display_name: input.display_name, city_id: input.city_id };

  // A new business is created first (its address is made from the name),
  // then given its headline and bio: a provider can't set those on insert.
  let id = existing?.id;
  if (!id) {
    // No slug: the providers_set_slug trigger makes it from the name (the
    // generated types list it as required because it has no column default,
    // and providers may not write it).
    const row = { ...base, owner_id: user.sub } as unknown as Database["public"]["Tables"]["providers"]["Insert"];
    const { data: created, error } = await supabase.from("providers").insert(row).select("id").single();
    if (error) throw createError({ statusCode: 500, statusMessage: error.message });
    id = created.id;
  }
  const { data, error } = await supabase.from("providers").update({ ...base, ...profile }).eq("id", id).select("*").single();
  if (error) {
    if (error.code === "23514") throw createError({ statusCode: 400, statusMessage: "Leave phone numbers, emails and links out of your headline and bio." });
    throw createError({ statusCode: 500, statusMessage: error.message });
  }
  return data;
});
