<script setup lang="ts">
// Shared by every heart (docs/design/favourites.md, The sign-in return trip):
// a signed-out visitor who taps one is asked to sign in first, and the
// page's polite announcement of each save or unsave for screen readers.
const { signInFor, signInToSave, announcement, reset, load } = useSaved();
// A different person (or nobody): the hearts start again from their saved items.
const user = useSupabaseUser();
watch(() => user.value?.sub, () => {
  reset();
  void load();
});
// The dialog's own copy: its Sign in button closes the dialog (clearing
// signInFor) before the click handler runs.
const item = ref(signInFor.value);
watch(signInFor, (s) => { if (s) item.value = s; });
const open = computed({ get: () => !!signInFor.value, set: (o: boolean) => { if (!o) signInFor.value = null; } });
function signIn() {
  if (item.value) void signInToSave(item.value);
}
</script>

<template>
  <div>
  <UiAlertDialog v-model:open="open" :title="`Sign in to save ${item?.name ?? ''}`"
    description="Saved items stay in your account, so you can come back to them. We'll bring you back here.">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Not now" />
        <UiAlertDialogAction text="Sign in" @click="signIn" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
  <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </div>
</template>
