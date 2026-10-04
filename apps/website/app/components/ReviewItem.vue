<script setup lang="ts">
import { bookedLabel, reviewStarsSpoken, type PublicReview } from "@repo/types";

// One published review (docs/design/reviews.md, Each review shows): the
// stars with their words, the name, the booking's month, the text, "Edited",
// and the provider's reply under it. "Report" on each.
const props = defineProps<{ review: PublicReview; providerName: string; providerAvatar?: string | null; showListing?: boolean }>();
const emit = defineEmits<{ report: [target: "review" | "reply"] }>();
const listingHref = computed(() => props.review.listing
  ? `/${props.review.listing.kind === "experience" ? "experiences" : "services"}/${props.review.listing.slug}` : null);
</script>

<template>
  <article class="space-y-2" :aria-label="`Review by ${review.reviewerName}`">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <ReviewStars :value="review.rating" :spoken="reviewStarsSpoken(review.rating)" />
      <p class="font-medium">{{ review.reviewerName }}</p>
      <p class="text-muted-foreground text-sm">{{ bookedLabel(review.bookingMonth) }}<template v-if="review.editedAt"> · Edited</template></p>
    </div>
    <p v-if="showListing && review.listing" class="text-sm">
      For <NuxtLink :to="listingHref!" class="font-medium">{{ review.listing.title }}</NuxtLink>
    </p>
    <p class="leading-relaxed whitespace-pre-line">{{ review.body }}</p>
    <button type="button" class="text-muted-foreground hover:text-foreground -mx-1 min-h-11 rounded px-1 text-sm"
      :aria-label="`Report ${review.reviewerName}'s review`" @click="emit('report', 'review')">Report</button>

    <div v-if="review.reply" class="border-border ml-4 space-y-1.5 border-l-2 pl-4">
      <div class="flex items-center gap-2">
        <ProviderAvatar :name="providerName" :path="providerAvatar" :size="28" />
        <p class="text-sm font-medium">Reply from {{ providerName }}<span v-if="review.reply.editedAt" class="text-muted-foreground font-normal"> · Edited</span></p>
      </div>
      <p class="text-sm leading-relaxed whitespace-pre-line">{{ review.reply.body }}</p>
      <button type="button" class="text-muted-foreground hover:text-foreground -mx-1 min-h-11 rounded px-1 text-sm"
        :aria-label="`Report the reply to ${review.reviewerName}'s review`" @click="emit('report', 'reply')">Report</button>
    </div>
  </article>
</template>
