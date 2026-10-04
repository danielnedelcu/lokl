<script setup lang="ts">
// The website's sign-in dialog (docs/design/sign-in-with-code.md), opened by
// useSignIn() from "Sign in to book", a heart, or the header. Signed in by
// code, the person stays on the page: the dialog closes, focus goes back,
// and the page's signed-in parts refresh in place. Also the hearts' polite
// live region, and their reset when the person signing in changes. Browser
// only (app.vue).
const { current, close } = useSignIn();
const { announcement, reset, load } = useSaved();
const user = useSupabaseUser();
const route = useRoute();
const redirect = useSupabaseCookieRedirect();

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

// The emailed link comes back to this page.
function beforeSend() {
  redirect.path.value = route.fullPath.split("?")[0]!;
  current.value?.beforeSend?.();
}

async function signedIn(email: string) {
  // Signed in here, so the link's way back isn't needed.
  redirect.pluck();
  const restoreFocus = close();
  useSonner.success(`Signed in as ${email}.`);
  // Focus once the page shows the signed-in person (the account menu, the
  // booking form), so a redraw can't take it away again.
  await refreshNuxtData();
  await nextTick();
  restoreFocus();
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
