<script setup lang="ts">
import type { HomepageGuide, PublicBrowseResult, PublicListingCard, PublicMarket } from "@repo/types";

// The homepage: our own markup and components only, nothing loaded from
// other sites. Deliberately simple; the design comes in the UX polish pass
// (docs/TODO.md, launch prep). Atlanta is the only market for now.
definePageMeta({ layout: "public" });

const MARKET = "atlanta";

const [{ data: experiences }, { data: services }, { data: homeGuides }, { data: picks }] = await Promise.all([
  useFetch<PublicBrowseResult>("/api/public/browse", { key: "home-experiences", query: { market: MARKET, kind: "experience" } }),
  useFetch<PublicBrowseResult>("/api/public/browse", { key: "home-services", query: { market: MARKET, kind: "service" } }),
  useFetch<HomepageGuide[]>("/api/public/homepage-guides", { key: "home-guides" }),
  useFetch<{ market: PublicMarket | null; experience: PublicListingCard | null; service: PublicListingCard | null }>(
    "/api/public/homepage-listings", { key: "home-picks", query: { market: MARKET } }),
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

// "On lokl now": one Experience and one Service beside the host card, each
// chosen at random on the server (homepage-listings, cached for a minute),
// so the server and the browser show the same two (2026-10-12; four in turn
// before). A kind with none shows just the other.
const featured = computed(() => [picks.value?.experience, picks.value?.service].filter((c): c is PublicListingCard => !!c));
const market = computed(() => picks.value?.market ?? experiences.value?.market ?? services.value?.market ?? null);

// Below the invitation to host: a carousel each of Experiences and Services,
// up to 10 listings and then "See all" (2026-10-12; ScrollCarousel). A kind
// with no live listings has no carousel.
const PER_ROW = 10;
const rows = computed(() => [
  { label: "Experiences", path: `/${MARKET}/experiences`, result: experiences.value },
  { label: "Services", path: `/${MARKET}/services`, result: services.value },
].filter((r) => r.result?.items.length).map((r) => ({
  label: r.label,
  items: r.result!.items.slice(0, PER_ROW) as PublicListingCard[],
  seeAll: { href: r.path, label: r.result!.total > PER_ROW ? `See all ${r.label} (${r.result!.total})` : `See all ${r.label}` },
})));

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

    <section aria-labelledby="featured-heading" class="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id="featured-heading" class="text-xl font-semibold">On lokl now</h2>
        <NuxtLink :to="`/${MARKET}`" class="link-tertiary">Everything in Atlanta <Icon name="lucide:arrow-right" aria-hidden="true" /></NuxtLink>
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

    <!-- A carousel each of Experiences and Services (2026-10-12). -->
    <div v-if="rows.length && market" class="mx-auto mb-20 max-w-6xl space-y-16 px-4 md:mb-28">
      <ScrollCarousel v-for="row in rows" :key="row.label" :label="row.label" :items="row.items" :item-key="(l) => l.id"
        :see-all="row.seeAll">
        <template #item="{ item }">
          <ListingCard :listing="item" :market="market" />
        </template>
      </ScrollCarousel>
    </div>

    <HomepageGuidesSection v-if="mainGuide" :cards="cards" :market="mainGuide.market" :market-name="market?.name ?? 'Atlanta'" />

    <HostingSection />
  </div>
</template>
