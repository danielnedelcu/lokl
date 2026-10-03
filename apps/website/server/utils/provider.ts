import type { Provider } from "@repo/types";
import type { ProviderAction } from "./providerAccess";
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server";

// Nitro's request event, taken from the Supabase helpers so it's always the
// h3 that Nitro runs (h3 isn't a direct dependency of this app).
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
// A suspended provider is refused, except for what providerMay() allows them
// (seeing and cancelling their bookings): pass that action.
export async function requireProvider(event: ServerEvent, action: ProviderAction = "other") {
  const provider = await getOwnProvider(event);
  if (!provider) {
    throw createError({ statusCode: 403, statusMessage: "Set up your business profile first" });
  }
  if (!providerMay(provider.status, action)) {
    throw createError({ statusCode: 403, statusMessage: "Your account is paused, so this isn't available. Questions? Reply to our email." });
  }
  return provider;
}
