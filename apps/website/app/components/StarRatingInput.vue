<script setup lang="ts">
import { STAR_WORDS, starLabel } from "@repo/types";

// The review form's stars (docs/design/reviews.md, The review form).
// UiRating can't be used here: its stars are click-only shapes, with no
// keyboard use or names. This is ui-thing's radio group (Reka) drawn as five
// stars: a group named "Your rating", five radio buttons named "1 star:
// Poor" to "5 stars: Excellent", the arrow keys moving between them, and
// the chosen value written beside them, never the stars alone.
const props = defineProps<{ id: string; invalid?: boolean; describedBy?: string }>();
const model = defineModel<number | null>({ default: null });
const hovered = ref<number | null>(null);
const shown = computed(() => hovered.value ?? model.value ?? 0);
const value = computed({
  get: () => (model.value ? String(model.value) : undefined),
  set: (v?: string) => (model.value = v ? Number(v) : null),
});
const levels = [1, 2, 3, 4, 5] as const;
</script>

<template>
  <div class="space-y-1.5">
    <p :id="`${props.id}-label`" class="text-sm font-medium">Your rating</p>
    <div class="flex flex-wrap items-center gap-3">
      <UiRadioGroup v-model="value" orientation="horizontal" :aria-labelledby="`${props.id}-label`"
        :aria-describedby="describedBy" :aria-invalid="invalid || undefined" class="flex gap-0" @mouseleave="hovered = null">
        <UiRadioGroupItem v-for="n in levels" :id="n === 1 ? props.id : undefined" :key="n" :value="String(n)" :aria-label="starLabel(n)"
          class="size-11 rounded-md border-0 shadow-none flex items-center justify-center" @mouseenter="hovered = n">
          <Icon name="lucide:star" aria-hidden="true"
            :class="['size-7', n <= shown ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40']" />
        </UiRadioGroupItem>
      </UiRadioGroup>
      <p class="text-sm" aria-hidden="true">{{ model ? `${model} ${model === 1 ? "star" : "stars"}: ${STAR_WORDS[model as 1 | 2 | 3 | 4 | 5]}` : "Not rated yet" }}</p>
    </div>
  </div>
</template>
