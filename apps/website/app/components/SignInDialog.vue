<script setup lang="ts">
// The website's sign-in dialog (docs/design/sign-in-with-code.md), opened by
// useSignIn() from "Sign in to book", a heart, the header or "Get started".
// Signed in by code, the person stays on the page: the dialog closes, focus
// goes back, and the page's signed-in parts refresh in place. A request with
// a destination (goTo) goes there instead, with focus on its main content.
// From the header, people who have a business are offered their dashboard
// in the toast. Also the hearts' polite live region, and their reset when
// the person signing in changes. Browser only (app.vue).
const { current, close } = useSignIn();
const { announcement, reset, load } = useSaved();
const user = useSupabaseUser();
const route = useRoute();
const redirect = useSupabaseCookieRedirect();
// The signed-in person's business, as the public layout loads it (useOwnProvider).
const { data: provider } = useNuxtData<{ id: string } | null>("provider");

// A different person (or nobody): the hearts start again from their saved items.
watch(() => user.value?.sub, () => {
  reset();
  void load();
});

// Dismissed (Escape, Close, outside): focus goes back on the opener as the
// dialog lets go of it (closeAutoFocus). Signed in: after the redraw (below).
let onDismissed: (() => void) | null = null;
const open = computed({ get: () => !!current.value, set: (o: boolean) => { if (!o) onDismissed = close(); } });
function closeAutoFocus(event: Event) {
  event.preventDefault();
  onDismissed?.();
  onDismissed = null;
}

// The emailed link comes back to this page, or goes to the request's destination.
function beforeSend() {
  redirect.path.value = sitePath(current.value?.goTo) ?? route.fullPath.split("?")[0]!;
  current.value?.beforeSend?.();
}

async function signedIn(email: string) {
  // Signed in here, so the link's way back isn't needed.
  redirect.pluck();
  const request = current.value;
  const restoreFocus = close();
  const goTo = sitePath(request?.goTo);
  if (goTo) {
    useSonner.success(`Signed in as ${email}.`);
    await signedInUserShown();
    const leaving = document.getElementById("main");
    await navigateTo(goTo);
    focusMainOn(goTo, leaving);
    return;
  }
  // Focus once the page shows the signed-in person (the account menu, the
  // booking form), so a redraw can't take it away again. The module sets
  // the signed-in user only after its own claims request answers, which can
  // come after the refresh; until then the header still shows "Sign in", and
  // focus went back to that button just before it was replaced (an
  // intermittent end-to-end failure, 2026-10-09).
  await signedInUserShown();
  await refreshNuxtData();
  await nextTick();
  // From the header, people who have a business are offered their
  // dashboard; it's in the account menu too, so the toast isn't the only way.
  if (request?.offerDashboard && provider.value) {
    useSonner.success(`Signed in as ${email}.`, {
      duration: 10_000,
      action: { label: "Go to your dashboard", onClick: () => void navigateTo("/dashboard") },
    });
  } else {
    useSonner.success(`Signed in as ${email}.`);
  }
  restoreFocus();
}

/**
 * After going to another page: focus its main content once that page is
 * shown, not the one being left, which can linger for a moment (looked for
 * up to two seconds).
 */
function focusMainOn(path: string, leaving: HTMLElement | null) {
  let tries = 0;
  const place = () => {
    const main = route.path === path ? document.getElementById("main") : null;
    if (main && main !== leaving && main.isConnected) return main.focus();
    if (++tries < 40) setTimeout(place, 50);
  };
  place();
}

/** Resolves once useSupabaseUser() has the signed-in person (or after 5 s, so focus is never left waiting). */
function signedInUserShown() {
  if (user.value) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      stop();
      clearTimeout(timer);
      resolve();
    };
    const stop = watch(() => user.value?.sub, (id) => id && done());
    const timer = setTimeout(done, 5000);
  });
}
</script>

<template>
  <div>
    <UiDialog v-model:open="open">
      <!-- Focus is put back by useSignIn, after the page has redrawn. -->
      <UiDialogContent class="sm:max-w-md" @close-auto-focus="closeAutoFocus">
        <UiDialogHeader>
          <UiDialogTitle>{{ current?.title }}</UiDialogTitle>
          <UiDialogDescription>We'll email you a code to sign in here, without leaving this page.</UiDialogDescription>
        </UiDialogHeader>
        <SignInForm v-if="current" :create-user="true" new-account-hint id-prefix="sign-in-dialog"
          :before-send="beforeSend" @signed-in="signedIn" />
      </UiDialogContent>
    </UiDialog>
    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </div>
</template>
