// A session whose user no longer exists (an account deleted while this
// browser was signed in to it) is cleared, and the page shown signed out
// (2026-10-12). The access token checks out on its own until it runs out,
// up to an hour, so once per page load in the browser, while signed in, it
// asks Supabase for the user. Only an answer that the user or the session
// is gone signs out, in this browser only: a network failure or any other
// error leaves the session as it is. Journey 25 checks it.
const GONE = new Set(["user_not_found", "session_not_found", "refresh_token_not_found"]);

export default defineNuxtPlugin(() => {
  const supabase = useSupabaseClient();
  const user = useSupabaseUser();
  onNuxtReady(async () => {
    if (!user.value) return;
    const { error } = await supabase.auth.getUser();
    if (error?.code && GONE.has(error.code)) await supabase.auth.signOut({ scope: "local" });
  });
});
