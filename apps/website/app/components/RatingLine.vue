<script setup lang="ts">
import { ratingLine, type RatingSummary } from "@repo/types";

// The rating line under a listing's title or a provider's name
// (docs/design/reviews.md): "New on lokl", "New on lokl · 2 reviews", or
// stars with "4.8 · 12 reviews" from 3. It links to the Reviews section when
// there are reviews. Screen readers hear the words ("Rated 4.8 out of 5
// from 12 reviews"); the stars are drawn only.
const props = withDefaults(defineProps<{ rating: RatingSummary; href?: string }>(), { href: "#reviews" });
const line = computed(() => ratingLine(props.rating));
</script>

<template>
  <p class="flex items-center gap-1.5 text-sm">
    <component :is="rating.count ? 'a' : 'span'" :href="rating.count ? href : undefined"
      class="inline-flex items-center gap-1.5" :class="rating.count && 'font-medium'">
      <ReviewStars v-if="line.showAverage" :value="rating.average ?? 0" spoken="" />
      <span aria-hidden="true">{{ line.text }}</span>
      <span class="sr-only">{{ line.spoken }}</span>
    </component>
  </p>
</template>
