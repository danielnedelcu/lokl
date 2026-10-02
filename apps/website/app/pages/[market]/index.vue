<script setup lang="ts">
import type { PublicBrowseResult, PublicMarketInfo } from "@repo/types";

// A market's page, e.g. /atlanta (docs/design/browse-and-listing-pages.md):
// a short hub with the first few Experiences and Services, and the
// categories that have listings.
definePageMeta({ layout: "public" });

const marketSlug = String(useRoute().params.market);
const notFound = () => createError({ statusCode: 404, fatal: true });

const { data: info, error } = await useFetch<PublicMarketInfo>(`/api/public/markets/${marketSlug}`, { key: `public-market-${marketSlug}` });
if (error.value || !info.value) throw notFound();

const [{ data: experiences }, { data: services }] = await Promise.all([
  useFetch<PublicBrowseResult>("/api/public/browse", { key: `public-market-exp-${marketSlug}`, query: { market: marketSlug, kind: "experience" } }),
  useFetch<PublicBrowseResult>("/api/public/browse", { key: `public-market-svc-${marketSlug}`, query: { market: marketSlug, kind: "service" } }),
]);

const market = computed(() => info.value!.market);
const sections = computed(() => [
  { kind: "experience" as const, title: "Experiences", path: `/${marketSlug}/experiences`, result: experiences.value,
    empty: `There are no Experiences in ${market.value.name} yet. New ones are added every week.` },
  { kind: "service" as const, title: "Services", path: `/${marketSlug}/services`, result: services.value,
    empty: `There are no Services in ${market.value.name} yet. New ones are added every week.` },
]);
const categoriesOf = (kind: "experience" | "service") => info.value!.categories.filter((c) => c.kind === kind && c.count > 0);

const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
useSeoMeta({
  title: () => `Things to do and book in ${market.value.name}`,
  description: () => `Experiences and services from local people across the ${market.value.name} metro, from tours and classes to help at home.`,
});
useHead({ link: [{ rel: "canonical", href: `${siteUrl}/${marketSlug}` }] });
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8 md:py-12">
    <header class="max-w-2xl">
      <h1 class="text-2xl font-semibold tracking-tight md:text-4xl">Things to do and book in {{ market.name }}</h1>
      <p class="mt-3">Experiences and services from local people across the {{ market.name }} metro.</p>
    </header>

    <section v-for="s in sections" :key="s.kind" :aria-labelledby="`${s.kind}-heading`" class="mt-12">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <h2 :id="`${s.kind}-heading`" class="text-xl font-semibold">{{ s.title }}</h2>
        <NuxtLink v-if="s.result?.total" :to="s.path" class="text-sm underline underline-offset-4">
          See all {{ s.title }} ({{ s.result.total }})
        </NuxtLink>
      </div>
      <ul v-if="categoriesOf(s.kind).length" class="mt-3 flex flex-wrap gap-2" :aria-label="`${s.title} categories`">
        <li v-for="c in categoriesOf(s.kind)" :key="c.slug">
          <NuxtLink :to="`${s.path}/${c.slug}`" class="border-border hover:bg-accent inline-flex min-h-11 items-center rounded-full border px-4 text-sm">
            {{ c.name }}<span class="opacity-70">&nbsp;({{ c.count }})</span>
          </NuxtLink>
        </li>
      </ul>
      <p v-if="!s.result?.items.length" class="border-border mt-4 rounded-lg border border-dashed p-6 text-center text-sm">{{ s.empty }}</p>
      <ul v-else class="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="item in s.result.items.slice(0, 6)" :key="item.id">
          <ListingCard :listing="item" :market="market" />
        </li>
      </ul>
    </section>
  </div>
</template>
