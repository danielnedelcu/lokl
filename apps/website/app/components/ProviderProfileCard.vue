<script setup lang="ts">
import type { PublicListingCard, PublicMarket, PublicProvider } from "@repo/types";

// The provider on a listing page (docs/design/provider-profiles.md, On the
// listing page): who they are, then "More from" with up to three of their
// other listings. Replaces the one-line "Hosted by". The rating beside the
// name comes with reviews (Room for later); nothing shows in its place now.
const props = defineProps<{
  provider: PublicProvider;
  /** "Hosted by" (Experiences) or "Offered by" (Services). */
  heading: string;
  more: { items: PublicListingCard[]; total: number };
  market: PublicMarket;
}>();
const profileUrl = computed(() => `/providers/${props.provider.slug}`);
const since = computed(() =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: props.market.timezone }).format(new Date(props.provider.since)));
const facts = computed(() => [props.provider.market ? `Based in ${props.provider.market}` : null, `On lokl since ${since.value}`].filter(Boolean).join(" · "));
</script>

<template>
  <section aria-labelledby="provider-heading" class="border-border rounded-xl border p-5">
    <h2 id="provider-heading" class="text-muted-foreground text-sm font-medium">{{ heading }}</h2>
    <div class="mt-3 flex items-start gap-4">
      <ProviderAvatar :name="provider.name" :path="provider.avatarSmallPath" :size="56" />
      <div class="min-w-0 flex-1">
        <!-- The provider's combined rating beside the name (docs/design/reviews.md). -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p class="text-lg font-semibold">
            <NuxtLink :to="profileUrl">{{ provider.name }}</NuxtLink>
          </p>
          <RatingLine :rating="provider.rating" :href="`${profileUrl}#reviews`" />
        </div>
        <p v-if="provider.headline" class="mt-0.5">{{ provider.headline }}</p>
        <p class="text-muted-foreground mt-1 text-sm">{{ facts }}</p>
      </div>
    </div>
    <p v-if="provider.bio" class="mt-4 line-clamp-2 leading-relaxed whitespace-pre-line">{{ provider.bio }}</p>
    <NuxtLink :to="profileUrl" class="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium">
      View {{ provider.name }}'s profile<Icon name="lucide:arrow-right" class="size-4" aria-hidden="true" />
    </NuxtLink>
  </section>

  <section v-if="more.items.length" aria-labelledby="more-heading">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="more-heading" class="text-lg font-semibold">More from {{ provider.name }}</h2>
      <NuxtLink v-if="more.total > more.items.length" :to="profileUrl" class="text-sm font-medium">See all ({{ more.total }})</NuxtLink>
    </div>
    <ul class="mt-3 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      <li v-for="item in more.items" :key="item.id">
        <ListingCard :listing="item" :market="market" />
      </li>
    </ul>
  </section>
</template>
