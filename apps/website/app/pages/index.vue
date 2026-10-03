<script setup lang="ts">
import type { HomepageGuide, PublicBrowseResult, PublicListingCard } from "@repo/types";

// The homepage: our own markup and components only, nothing loaded from
// other sites. Deliberately simple; the design comes in the UX polish pass
// (docs/TODO.md, launch prep). Atlanta is the only market for now.
definePageMeta({ layout: "public" });

const MARKET = "atlanta";

const [{ data: experiences }, { data: services }, { data: homeGuides }] = await Promise.all([
  useFetch<PublicBrowseResult>("/api/public/browse", { key: "home-experiences", query: { market: MARKET, kind: "experience" } }),
  useFetch<PublicBrowseResult>("/api/public/browse", { key: "home-services", query: { market: MARKET, kind: "service" } }),
  useFetch<HomepageGuide[]>("/api/public/homepage-guides", { key: "home-guides" }),
]);
// Featured guides come first (docs/design/destination-guides.md, The
// homepage); without any, the page is as it was, headline first.
const guides = computed(() => homeGuides.value ?? []);
const headline = "Book local Experiences and Services in Atlanta";

// Up to six live listings, alternating Experiences and Services.
const featured = computed(() => {
  const a = experiences.value?.items ?? [];
  const b = services.value?.items ?? [];
  const out: PublicListingCard[] = [];
  for (let i = 0; out.length < 6 && (i < a.length || i < b.length); i++) {
    if (a[i]) out.push(a[i]!);
    if (b[i] && out.length < 6) out.push(b[i]!);
  }
  return out;
});
const market = computed(() => experiences.value?.market ?? services.value?.market ?? null);

const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
useSeoMeta({
  title: "Book local Experiences and Services in Atlanta",
  description: "Tours, classes and outings hosted by local people, and services at your place or theirs, across the Atlanta metro.",
});
useHead({ link: [{ rel: "canonical", href: `${siteUrl}/` }] });
</script>

<template>
  <div>
    <!-- With guides first, the page's main heading still comes first for screen
         readers (hidden), and the visible headline below the guides is styled
         the same but isn't a heading (decided 2026-10-03). -->
    <template v-if="guides.length">
      <h1 class="sr-only">{{ headline }}</h1>
      <HomepageGuides :guides="guides" />
    </template>
    <section class="border-border border-b">
      <div class="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <component :is="guides.length ? 'p' : 'h1'" class="max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl">
          {{ headline }}
        </component>
        <p class="text-muted-foreground mt-4 max-w-xl text-lg">
          Tours, classes and outings hosted by local people, and services at your place or theirs, across the metro.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <UiButton :to="`/${MARKET}/experiences`">Browse Experiences</UiButton>
          <UiButton variant="outline" :to="`/${MARKET}/services`">Browse Services</UiButton>
        </div>
      </div>
    </section>

    <section aria-labelledby="featured-heading" class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <h2 id="featured-heading" class="text-xl font-semibold">On lokl now</h2>
        <NuxtLink :to="`/${MARKET}`" class="text-sm underline underline-offset-4">Everything in Atlanta</NuxtLink>
      </div>
      <p v-if="!featured.length" class="border-border mt-6 rounded-lg border border-dashed p-6 text-center text-sm">
        The first listings are on their way. Check back soon.
      </p>
      <ul v-else-if="market" class="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="item in featured" :key="item.id">
          <ListingCard :listing="item" :market="market" />
        </li>
      </ul>
    </section>

    <section aria-labelledby="providers-heading" class="bg-muted">
      <div class="mx-auto max-w-6xl px-4 py-12 md:py-16">
        <h2 id="providers-heading" class="text-xl font-semibold">Offer your Services or host Experiences</h2>
        <p class="mt-2 max-w-xl">
          No upfront fees. Set your price, choose where you work, and get paid through Stripe. lokl only takes a
          commission when you're booked.
        </p>
        <UiButton class="mt-6" to="/login">Get started</UiButton>
      </div>
    </section>
  </div>
</template>
