<script setup lang="ts">
import type { PublicGuidesIndex, PublicMarketInfo } from "@repo/types";

// The guides index, e.g. /atlanta/guides (docs/design/destination-guides.md,
// Public pages and SEO): every published guide, most recently updated first.
definePageMeta({ layout: "public" });

const marketSlug = String(useRoute().params.market);
// The market (for the heading) and its guides, separately: if the guides
// can't load, the page still shows, with a plain message, like the browse
// pages. Only a real 404 is "not found".
const [{ data: info, error: infoError }, { data, error }] = await Promise.all([
  useFetch<PublicMarketInfo>(`/api/public/markets/${marketSlug}`, { key: `public-market-${marketSlug}` }),
  useFetch<PublicGuidesIndex>(`/api/public/guides/${marketSlug}`, { key: `public-guides-${marketSlug}` }),
]);
if (infoError.value?.statusCode === 404 || error.value?.statusCode === 404) throw createError({ statusCode: 404, fatal: true });
const failed = computed(() => !!error.value || !data.value);
// A failed load is temporary: tell search engines so, rather than index the message.
if (failed.value && import.meta.server) setResponseStatus(useRequestEvent()!, 503);
const market = computed(() =>
  info.value?.market ?? data.value?.market ?? { name: marketSlug.charAt(0).toUpperCase() + marketSlug.slice(1), slug: marketSlug },
);
const guides = computed(() => data.value?.guides ?? []);

const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
const canonical = `${siteUrl}/${marketSlug}/guides`;
const photo = useGuidePhotoUrl();
useSeoMeta({
  title: () => `Guides to ${market.value.name}`,
  description: () => `Where to go and what to do in ${market.value.name}, from neighborhoods to the city's tours and classes, with local people to book.`,
  ogTitle: () => `Guides to ${market.value.name}`,
  ogImage: () => (guides.value[0] ? photo.url(guides.value[0].cover.path) : undefined),
  ogType: "website",
  ogUrl: canonical,
});
useHead({ link: [{ rel: "canonical", href: canonical }] });
const crumbs = computed(() => [
  { name: market.value.name, to: `/${marketSlug}` },
  { name: "Guides", to: `/${marketSlug}/guides` },
]);
useSchemaOrg([defineBreadcrumb({ itemListElement: crumbs.value.map((c) => ({ name: c.name, item: c.to })) })]);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8 md:py-12">
    <nav aria-label="Breadcrumb" class="text-muted-foreground mb-4 text-sm">
      <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li v-for="(c, i) in crumbs" :key="c.to" class="flex items-center gap-1.5">
          <NuxtLink v-if="i < crumbs.length - 1" :to="c.to" class="hover:text-foreground underline-offset-4 hover:underline">{{ c.name }}</NuxtLink>
          <span v-else aria-current="page" class="text-foreground">{{ c.name }}</span>
          <Icon v-if="i < crumbs.length - 1" name="lucide:chevron-right" class="size-3.5" aria-hidden="true" />
        </li>
      </ol>
    </nav>
    <header class="max-w-2xl">
      <h1 class="text-2xl font-semibold tracking-tight md:text-4xl">Guides to {{ market.name }}</h1>
      <p class="mt-3">Where to go and what to do around {{ market.name }}, and the local people you can book along the way.</p>
    </header>

    <UiAlert v-if="failed" variant="destructive" class="mt-8">
      <UiAlertTitle>The guides didn't load</UiAlertTitle>
      <UiAlertDescription>Please try again in a moment.</UiAlertDescription>
    </UiAlert>
    <p v-else-if="!guides.length" class="border-border mt-8 rounded-lg border border-dashed p-6 text-center text-sm">
      Guides are on their way. In the meantime, <NuxtLink :to="`/${marketSlug}`" class="underline underline-offset-4">see what's on in {{ market.name }}</NuxtLink>.
    </p>
    <ul v-else class="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="(g, i) in guides" :key="g.slug">
        <GuideCard :href="`/${marketSlug}/guides/${g.slug}`" :title="g.title" :teaser="g.teaser" :cover="g.cover" :heading-level="2"
          :priority="i < 3" sizes="100vw sm:50vw lg:33vw" />
      </li>
    </ul>
  </div>
</template>
