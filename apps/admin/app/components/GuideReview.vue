<script setup lang="ts">
import type { BodyPhrase } from "~/utils/guidePhrases";

// While an AI draft waits for review (docs/design/destination-guides.md,
// Review): the banner, the phrases to check with their reasons, and "Mark
// as reviewed", which asks the admin to confirm two things first. The
// database records who and when, and refuses to publish until it's done.
const props = defineProps<{ phrases: BodyPhrase[]; busy: boolean }>();
const emit = defineEmits<{ reveal: [phrase: BodyPhrase]; confirm: [] }>();

const open = ref(false);
const checkedPhrases = ref(false);
const checkedFacts = ref(false);
function ask() {
  checkedPhrases.value = checkedFacts.value = false;
  open.value = true;
}
const where = (p: BodyPhrase) => (p.blockId === "title" ? "Title" : p.blockId === "teaser" ? "Teaser" : null);
defineExpose({ close: () => (open.value = false) });
</script>

<template>
  <section aria-labelledby="review-heading" class="border-destructive/40 bg-destructive/5 space-y-3 rounded-lg border p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="review-heading" class="flex items-center gap-1 font-medium">
          <Icon name="lucide:shield-alert" aria-hidden="true" />AI draft, not reviewed yet
        </h2>
        <p class="mt-1 text-sm">Check every highlighted phrase and every fact before publishing.</p>
      </div>
      <UiButton size="sm" :disabled="busy" @click="ask">Mark as reviewed</UiButton>
    </div>

    <div class="text-sm">
      <p class="font-medium">
        {{ props.phrases.length ? `Phrases to check (${props.phrases.length})` : "No phrases flagged. Still check the facts." }}
      </p>
      <ul v-if="props.phrases.length" class="mt-2 space-y-2">
        <li v-for="p in props.phrases" :key="p.key">
          <button type="button" class="hover:bg-accent w-full rounded-md p-2 text-left" @click="emit('reveal', p)">
            <span v-if="where(p)" class="text-muted-foreground">{{ where(p) }}: </span>
            <span>{{ p.context.before }}</span><mark class="bg-destructive/15 rounded px-0.5 font-medium text-inherit underline decoration-wavy">{{ p.context.phrase }}</mark><span>{{ p.context.after }}</span>
            <span class="text-muted-foreground mt-0.5 flex items-center gap-1">
              <Icon name="lucide:info" class="shrink-0" aria-hidden="true" />{{ p.reason }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </section>

  <UiAlertDialog v-model:open="open">
    <template #header>
      <UiAlertDialogHeader>
        <UiAlertDialogTitle title="Mark this AI draft as reviewed?" />
        <UiAlertDialogDescription
          description="It can be published once it's reviewed. You don't have to change anything, but confirm both of these first." />
      </UiAlertDialogHeader>
      <div class="space-y-3 py-2">
        <label class="flex min-h-11 cursor-pointer items-start gap-3">
          <UiCheckbox class="mt-0.5" :model-value="checkedPhrases" @update:model-value="(v: boolean | 'indeterminate') => (checkedPhrases = v === true)" />
          <span class="text-sm">I've checked every highlighted phrase{{ props.phrases.length ? ` (${props.phrases.length})` : "" }}.</span>
        </label>
        <label class="flex min-h-11 cursor-pointer items-start gap-3">
          <UiCheckbox class="mt-0.5" :model-value="checkedFacts" @update:model-value="(v: boolean | 'indeterminate') => (checkedFacts = v === true)" />
          <span class="text-sm">I've checked the facts.</span>
        </label>
      </div>
    </template>
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Not yet" />
        <UiAlertDialogAction text="Mark as reviewed" :disabled="busy || !checkedPhrases || !checkedFacts" @click.prevent="emit('confirm')" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
