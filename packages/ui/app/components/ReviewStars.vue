<script setup lang="ts">
// Stars for display (docs/design/reviews.md): ui-thing's UiRating, which is
// drawn only, so it's hidden from screen readers and the words are given
// instead ("4 out of 5 stars", or the caller's). Never the stars alone.
const props = withDefaults(defineProps<{
  /** 0 to 5; an average may have a decimal (4.8 fills part of the fifth star). */
  value: number;
  /** What a screen reader hears instead of the stars. */
  spoken?: string;
  size?: "sm" | "md" | "lg";
}>(), { spoken: undefined, size: "sm" });
const words = computed(() => props.spoken ?? `${props.value} out of 5 stars`);
</script>

<template>
  <span class="inline-flex items-center">
    <UiRating :model-value="value" :size="size" aria-hidden="true" class="gap-0" />
    <span class="sr-only">{{ words }}</span>
  </span>
</template>
