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
// The homepage's guides (docs/design/destination-guides.md, The homepage;
// three places since 2026-10-11): the main guide alone at the top, under a
// slim headline, then "On lokl now", then the guides section with up to two
// cards. Without a main guide (the list is empty then), the page is as it
// was: the headline first, and no guides.
const guides = computed(() => homeGuides.value ?? []);
const mainGuide = computed(() => guides.value[0]);
const cards = computed(() => guides.value.slice(1, 3));
const headline = "Book local Experiences and Services in Atlanta";

// Up to four live listings, alternating Experiences and Services: two rows
// of two beside the host card (2026-10-11; six, in rows of three, before).
const LISTINGS = 4;
const featured = computed(() => {
  const a = experiences.value?.items ?? [];
  const b = services.value?.items ?? [];
  const out: PublicListingCard[] = [];
  for (let i = 0; out.length < LISTINGS && (i < a.length || i < b.length); i++) {
    if (a[i]) out.push(a[i]!);
    if (b[i] && out.length < LISTINGS) out.push(b[i]!);
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
    <!-- With a main guide: the guide alone, with the page's h1 for screen
         readers only (no visible headline, 2026-10-11). Without one, the
         headline block comes first, as before. -->
    <HomepageHero v-if="mainGuide" :guide="mainGuide" :headline="headline" />
    <section v-else class="border-border border-b">
      <div class="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <h1 class="max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl">{{ headline }}</h1>
        <p class="text-muted-foreground mt-4 max-w-xl text-lg">
          Tours, classes and outings hosted by local people, and services at your place or theirs, across the metro.
        </p>
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <NuxtLink :to="`/${MARKET}/experiences`" class="link-primary">Browse Experiences</NuxtLink>
          <NuxtLink :to="`/${MARKET}/services`" class="link-secondary">Browse Services</NuxtLink>
        </div>
      </div>
    </section>

    <section aria-labelledby="featured-heading" class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id="featured-heading" class="text-xl font-semibold">On lokl now</h2>
        <NuxtLink :to="`/${MARKET}`" class="link-secondary">Everything in Atlanta</NuxtLink>
      </div>
      <!-- Listings in the left two columns, the host card the third; on
           tablets and phones the card follows the listings. -->
      <div class="mt-6 grid gap-x-6 gap-y-10 lg:grid-cols-3">
        <p v-if="!featured.length || !market" class="border-border rounded-lg border border-dashed p-6 text-center text-sm lg:col-span-2">
          The first listings are on their way. Check back soon.
        </p>
        <ul v-else class="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:col-span-2">
          <li v-for="item in featured" :key="item.id">
            <ListingCard :listing="item" :market="market" />
          </li>
        </ul>
        <HostCard />
      </div>
    </section>

    <HomepageGuidesSection v-if="mainGuide" :cards="cards" :market="mainGuide.market" :market-name="market?.name ?? 'Atlanta'" />

    <HostingSection />
  </div>
</template>
