<script setup lang="ts">
import { bookedLabel, REVIEW_RULES, reviewStarsSpoken, type ReviewRule } from "@repo/types";

// The provider's reviews (docs/design/reviews.md, Provider replies): all of
// them, those waiting for a reply first. Replying happens on each booking's
// page, beside the booking it's about.
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "Reviews" });

interface Row {
  id: string; bookingId: string; rating: number; body: string; reviewerName: string; bookingMonth: string;
  createdAt: string; editedAt: string | null; status: "published" | "removed"; removedRule: ReviewRule | null;
  listingTitle: string; replied: "published" | "removed" | null;
}
const { data, error, pending } = await useFetch<Row[]>("/api/provider/reviews", { key: "provider-reviews", headers: useRequestHeaders(["cookie"]) });
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <h1 class="text-2xl font-semibold tracking-tight">Reviews</h1>
    <p class="text-muted-foreground mt-1 text-sm">
      Customers can review a booking for 14 days after it ends. You can post one public reply to each.
      <NuxtLink to="/review-rules" class="font-medium">Review rules</NuxtLink>
    </p>

    <UiAlert v-if="error" variant="destructive" class="mt-6">
      <UiAlertTitle>Your reviews didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>
    <p v-else-if="pending" class="text-muted-foreground mt-6 text-sm">Loading…</p>
    <p v-else-if="!data?.length" class="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
      No reviews yet. Customers are asked to review once a booking has taken place.
    </p>
    <ul v-else class="divide-border mt-6 divide-y rounded-lg border">
      <li v-for="r in data" :key="r.id" class="space-y-2 p-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ReviewStars :value="r.rating" :spoken="reviewStarsSpoken(r.rating)" />
          <p class="font-medium">{{ r.reviewerName }}</p>
          <p class="text-muted-foreground text-sm">{{ r.listingTitle }} · {{ bookedLabel(r.bookingMonth) }}</p>
        </div>
        <p v-if="r.status === 'removed'" class="text-sm">lokl removed this review because it {{ r.removedRule ? REVIEW_RULES[r.removedRule].title.toLowerCase() : "broke a review rule" }}.</p>
        <p v-else class="line-clamp-3 whitespace-pre-line">{{ r.body }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton :to="`/dashboard/bookings/${r.bookingId}#review`" variant="outline" size="sm" class="min-h-11">
            {{ r.status === "published" && !r.replied ? "Reply" : "See the booking" }}<span class="sr-only"> to {{ r.reviewerName }}'s review</span>
          </UiButton>
          <p v-if="r.status === 'published' && !r.replied" class="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Icon name="lucide:message-circle" class="size-4" aria-hidden="true" />Not replied yet
          </p>
        </div>
      </li>
    </ul>
  </div>
</template>
