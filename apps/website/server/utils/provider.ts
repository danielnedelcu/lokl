import type { Provider } from "@repo/types";
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server";

// Nitro's request event. Not imported from "h3" because this app also depends
// on h3 v2, which Nitro doesn't use.
export type ServerEvent = Parameters<typeof serverSupabaseUser>[0];

export async function requireUser(event: ServerEvent) {
  const user = await serverSupabaseUser(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Sign in required" });
  }
  return user;
}

// The signed-in user's provider, read through RLS. Null if they haven't set one up.
export async function getOwnProvider(event: ServerEvent): Promise<Provider | null> {
  const user = await requireUser(event);
  const { data, error } = await (await serverSupabaseClient(event))
    .from("providers")
    .select("*")
    .eq("owner_id", user.sub)
    .maybeSingle();
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  return data as Provider | null;
}

// Call at the top of every provider-only server route before touching data.
export async function requireProvider(event: ServerEvent) {
  const provider = await getOwnProvider(event);
  if (!provider) {
    throw createError({ statusCode: 403, statusMessage: "Set up your business profile first" });
  }
  if (provider.status === "suspended") {
    throw createError({ statusCode: 403, statusMessage: "This account is suspended" });
  }
  return provider;
}
