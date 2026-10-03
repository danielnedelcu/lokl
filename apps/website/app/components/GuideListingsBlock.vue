<script setup lang="ts">
import type { PublicGuide, PublicListingCard } from "@repo/types";

// A guide's listings block (docs/design/destination-guides.md): up to six
// live listings matching its area and/or category and kind, as the usual
// listing cards, with "See all" to the matching browse page. Hidden when
// nothing matches, so a guide never shows an empty block.
const props = defineProps<{
  guide: PublicGuide;
  listings: { total: number; items: PublicListingCard[] };
}>();

const b = computed(() => props.guide.listings);
const market = computed(() => props.guide.market);
const plural = (k: "service" | "experience") => (k === "experience" ? "experiences" : "services");
const word = (k: "service" | "experience") => (k === "experience" ? "Experiences" : "Services");

const heading = computed(() => {
  const what = b.value.category?.name ?? (b.value.kind ? word(b.value.kind) : "");
  const where = b.value.area ? `in ${b.value.area.name}` : "";
  return ["Book", what, where].filter(Boolean).join(" ");
});
// The matching browse page: the category's, or the kind's (or both kinds'), filtered by area.
const seeAll = computed(() => {
  const area = b.value.area ? `?area=${b.value.area.id}` : "";
  const base = `/${market.value.slug}`;
  if (b.value.category) return [{ to: `${base}/${plural(b.value.category.kind)}/${b.value.category.slug}${area}`, label: `See all ${b.value.category.name}` }];
  const kinds = b.value.kind ? [b.value.kind] : (["experience", "service"] as const);
  return kinds.map((k) => ({ to: `${base}/${plural(k)}${area}`, label: `See all ${word(k)}${b.value.area ? ` in ${b.value.area.name}` : ""}` }));
});
</script>

<template>
  <section v-if="listings.total" aria-labelledby="guide-listings-heading" class="border-border mt-12 border-t pt-10">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <h2 id="guide-listings-heading" class="text-xl font-semibold">{{ heading }}</h2>
      <p class="flex flex-wrap gap-x-4 text-sm">
        <NuxtLink v-for="l in seeAll" :key="l.to" :to="l.to" class="underline underline-offset-4">{{ l.label }}</NuxtLink>
      </p>
    </div>
    <ul class="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="item in listings.items" :key="item.id">
        <ListingCard :listing="item" :market="market" />
      </li>
    </ul>
  </section>
</template>
