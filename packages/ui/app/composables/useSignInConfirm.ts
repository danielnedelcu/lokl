// The /confirm page's logic, shared by both apps. Sign-in links carry a
// one-time code that only works in the browser that requested the link
// (Supabase's PKCE flow keeps its other half there). Opened anywhere else the
// exchange fails without telling the page, which then waited forever. So the
// page gives up after a short wait, or at once if the link says it failed,
// and shows a way back to the login page. A session that turns up late still
// signs the person in.
//
// Why it failed: "expired" when Supabase says so (error_code=otp_expired,
// which it also uses for a link that was already used), otherwise "browser".

const WAIT_MS = 6000;

export function useSignInConfirm(fallbackPath: string) {
  const user = useSupabaseUser();
  const redirect = useSupabaseCookieRedirect();
  const failed = ref<null | "expired" | "browser">(null);

  watch(
    user,
    () => {
      if (user.value) navigateTo(redirect.pluck() || fallbackPath);
    },
    { immediate: true },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  onMounted(() => {
    // Supabase reports a failed or expired link as error= in the address.
    const params = new URLSearchParams(`${window.location.search.slice(1)}&${window.location.hash.slice(1)}`);
    if (params.get("error_code") === "otp_expired") {
      failed.value = "expired";
      return;
    }
    if (params.get("error") || params.get("error_code")) {
      failed.value = "browser";
      return;
    }
    timer = setTimeout(() => {
      if (!user.value) failed.value = "browser";
    }, WAIT_MS);
  });
  onBeforeUnmount(() => clearTimeout(timer));

  return { failed };
}
