<script setup lang="ts">
import { RATING_MIN_REVIEWS, type PublicReview, type PublicReviewPage, type RatingSummary, type StarCounts } from "@repo/types";

// The Reviews section on a listing page and a provider's profile
// (docs/design/reviews.md): from 3 reviews the breakdown first, then the
// reviews, newest first, 10 at a time with "Show more". Below 3, "New on
// lokl" and the reviews themselves. Report on each review and reply;
// signed out, the sign-in dialog comes first, then the report.
const props = defineProps<{
  listingId?: string;
  providerId?: string;
  rating: RatingSummary;
  stars: StarCounts;
  providerName: string;
  providerAvatar?: string | null;
  /** The profile page names each review's listing. */
  showListing?: boolean;
}>();

const query = computed(() => (props.listingId ? { listing: props.listingId } : { provider: props.providerId }));
const { data, error } = await useFetch<PublicReviewPage>("/api/public/reviews", {
  query: computed(() => ({ ...query.value, page: 1 })),
  key: `reviews-${props.listingId ?? props.providerId}`,
});
const more = ref<PublicReview[]>([]);
const page = ref(1);
const loadingMore = ref(false);
const moreError = ref("");
// A refresh (signing in refreshes the page's data) starts again from page one.
watch(data, () => {
  more.value = [];
  page.value = 1;
});
const items = computed(() => [...(data.value?.items ?? []), ...more.value]);
const total = computed(() => data.value?.total ?? props.rating.count);
async function showMore() {
  loadingMore.value = true;
  moreError.value = "";
  const firstNew = items.value.length;
  try {
    const next = await $fetch<PublicReviewPage>("/api/public/reviews", { query: { ...query.value, page: page.value + 1 } });
    more.value = [...more.value, ...next.items];
    page.value += 1;
    // Focus the first new review, so keyboard users carry on from there.
    await nextTick();
    document.querySelectorAll<HTMLElement>("[data-review]")[firstNew]?.focus();
  } catch {
    moreError.value = "More reviews didn't load. Try again.";
  } finally {
    loadingMore.value = false;
  }
}

// Reporting.
const user = useSupabaseUser();
const signIn = useSignIn();
const reporting = ref<{ reviewId: string; target: "review" | "reply"; name: string } | null>(null);
const reportOpen = ref(false);
const pending = ref<typeof reporting.value>(null);
function report(r: PublicReview, target: "review" | "reply") {
  const t = { reviewId: r.id, target, name: r.reviewerName };
  if (!user.value) {
    pending.value = t;
    signIn.open({ title: "Sign in to report a review" });
    return;
  }
  reporting.value = t;
  reportOpen.value = true;
}
// Signed in through the dialog: carry on to the report.
watch(() => user.value?.sub, (id) => {
  if (id && pending.value) {
    reporting.value = pending.value;
    pending.value = null;
    reportOpen.value = true;
  }
});
</script>

<template>
  <section id="reviews" aria-labelledby="reviews-heading" class="scroll-mt-20">
    <h2 id="reviews-heading" class="text-lg font-semibold">Reviews<template v-if="rating.count"> ({{ rating.count }})</template></h2>
    <p v-if="!rating.count" class="text-muted-foreground mt-2">New on lokl. No reviews yet.</p>
    <template v-else>
      <RatingBreakdown v-if="rating.count >= RATING_MIN_REVIEWS && rating.average != null" :rating="rating" :stars="stars" class="mt-4" />
      <p v-else class="text-muted-foreground mt-2 text-sm">New on lokl. The average shows once there are 3 reviews.</p>
      <p v-if="error" class="text-muted-foreground mt-4 text-sm">Reviews didn't load. Reload the page to try again.</p>
      <ul class="divide-border mt-6 divide-y">
        <li v-for="r in items" :key="r.id" data-review tabindex="-1" class="py-5 outline-none first:pt-0">
          <ReviewItem :review="r" :provider-name="providerName" :provider-avatar="providerAvatar" :show-listing="showListing"
            @report="(t) => report(r, t)" />
        </li>
      </ul>
      <div v-if="items.length < total" class="mt-2">
        <UiButton variant="outline" :disabled="loadingMore" @click="showMore">{{ loadingMore ? "Loading…" : "Show more reviews" }}</UiButton>
        <p v-if="moreError" role="alert" class="text-destructive mt-2 text-sm">{{ moreError }}</p>
      </div>
      <p class="text-muted-foreground mt-4 text-sm">
        Reviews are from customers whose booking took place. <NuxtLink to="/review-rules" class="font-medium">Our review rules</NuxtLink>
      </p>
    </template>
    <ReportReviewDialog v-if="reporting" v-model:open="reportOpen" :review-id="reporting.reviewId" :target="reporting.target" :name="reporting.name" />
  </section>
</template>
