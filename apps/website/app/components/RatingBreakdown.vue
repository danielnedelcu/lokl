<script setup lang="ts">
import { ratingBreakdown, ratingLine, type RatingSummary, type StarCounts } from "@repo/types";

// The top of a Reviews section from 3 reviews (docs/design/reviews.md): the
// average with its stars, then each star level with a bar, its count and
// share. Each row reads as text ("5 stars: 8 reviews, 67%"); the bars are
// drawn only. Counts come from the database (review_star_counts).
const props = defineProps<{ rating: RatingSummary; stars: StarCounts }>();
const rows = computed(() => ratingBreakdown(props.stars, props.rating.count));
const line = computed(() => ratingLine(props.rating));
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8">
    <div>
      <p class="text-4xl font-bold" aria-hidden="true">{{ rating.average?.toFixed(1) }}</p>
      <ReviewStars :value="rating.average ?? 0" size="md" spoken="" />
      <p class="text-muted-foreground mt-1 text-sm" aria-hidden="true">{{ rating.count }} reviews</p>
      <p class="sr-only">{{ line.spoken }}</p>
    </div>
    <ul class="space-y-1.5" aria-label="Reviews by stars">
      <li v-for="r in rows" :key="r.level" class="flex items-center gap-3 text-sm">
        <span class="sr-only">{{ r.spoken }}</span>
        <span class="w-14 shrink-0" aria-hidden="true">{{ r.level }} {{ r.level === 1 ? "star" : "stars" }}</span>
        <span class="bg-muted h-2 flex-1 overflow-hidden rounded-full" aria-hidden="true">
          <span class="block h-full rounded-full bg-yellow-400" :style="{ width: `${r.percent}%` }" />
        </span>
        <span class="text-muted-foreground w-20 shrink-0 text-right tabular-nums" aria-hidden="true">{{ r.count }} · {{ r.percent }}%</span>
      </li>
    </ul>
  </div>
</template>
