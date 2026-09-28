<script setup lang="ts">
// Confirms deactivating a category or city, saying how many live listings it
// will hide from the public site (design: step 6). The count comes from the
// page; listings keep their status and come back on reactivation, because
// the public read rule checks the category and city (listing_parents_active).
defineProps<{ name: string; liveCount: number | null; busy: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ confirm: [] }>();

const describe = (count: number | null) =>
  count === null
    ? "Checking how many live listings use it…"
    : count === 0
      ? "No live listings use it, so nothing disappears from the public site."
      : `This hides ${count} live ${count === 1 ? "listing" : "listings"} from the public site. ${count === 1 ? "It stays" : "They stay"} live and come back when you reactivate it.`;
</script>

<template>
  <UiAlertDialog v-model:open="open" :title="`Deactivate ${name}?`" :description="describe(liveCount)">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep it active" />
        <UiAlertDialogAction text="Deactivate" variant="destructive" :disabled="busy || liveCount === null"
          @click.prevent="emit('confirm')" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
