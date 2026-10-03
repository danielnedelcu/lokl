// Calls the website's admin routes (/api/admin/*), which do anything that
// needs Stripe: refunds, cancellations, payouts (decision 14). The admin's
// own Supabase token goes in the Authorization header; no cookies cross
// between the apps. The website checks the token, the admin role and that
// the call comes from this app's address.
export function useWebsiteAdmin() {
  const supabase = useSupabaseClient();
  const base = useRuntimeConfig().public.websiteUrl;
  return async function call<T = { result: string }>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your sign-in has expired. Sign in again.");
    try {
      return await $fetch<T>(`${base}/api/admin/${path}`, { method: "POST", body, headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
      throw new Error(err.data?.statusMessage ?? err.statusMessage ?? "The website didn't answer. Is it running?");
    }
  };
}
