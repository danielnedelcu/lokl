<script setup lang="ts">
import { photoCredit, type GuideBodyPhoto, type PublicGuide, type PublicListingCard } from "@repo/types";

// A destination guide, e.g. /atlanta/guides/a-day-in-old-fourth-ward
// (docs/design/destination-guides.md, Public pages and SEO): its live copy,
// drawn by lokl's own renderer, then its listings block. Drafts and
// unpublished guides are not found. Cached for up to a minute.
definePageMeta({ layout: "public" });

const route = useRoute();
const marketSlug = String(route.params.market);
const slug = String(route.params.slug);
const { data, error } = await useFetch<{ guide: PublicGuide; listings: { total: number; items: PublicListingCard[] } }>(
  `/api/public/guides/${marketSlug}/${slug}`,
  { key: `public-guide-${marketSlug}-${slug}` },
);
// Only a real 404 is "not found". Any other failure shows a plain message
// in the page (like the browse pages), sent as 503 so search engines treat
// it as temporary rather than index it.
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, data: { message: "We couldn't find that guide." }, fatal: true });
}
const failed = !!error.value || !data.value;
if (failed && import.meta.server) setResponseStatus(useRequestEvent()!, 503);
const g = computed(() => data.value?.guide as PublicGuide);
const market = computed(() => g.value.market);

const photo = useGuidePhotoUrl();
const photos = computed<Record<string, GuideBodyPhoto>>(() =>
  Object.fromEntries(g.value.photos.map((p) => [p.id, { url: photo.url(p.path), width: p.width, height: p.height, alt: p.alt, credit: photoCredit(p) }])),
);
const cover = computed(() => g.value.photos.find((p) => p.id === g.value.cover_photo_id));
const byline = computed(() => `lokl ${market.value.name}`);
const updated = computed(() => formatDate(g.value.content_updated_at, market.value.timezone));

const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
const canonical = `${siteUrl}/${marketSlug}/guides/${slug}`;
if (failed) useSeoMeta({ title: "This guide didn't load", robots: "noindex" });
else useSeoMeta({
  title: () => g.value.title,
  description: () => g.value.teaser,
  ogTitle: () => g.value.title,
  ogDescription: () => g.value.teaser,
  ogImage: () => (cover.value ? photo.url(cover.value.path) : undefined),
  ogImageAlt: () => cover.value?.alt,
  ogType: "article",
  ogUrl: canonical,
  twitterCard: "summary_large_image",
});
if (!failed) useHead({ link: [{ rel: "canonical", href: canonical }] });
const crumbs = computed(() => [
  { name: market.value.name, to: `/${marketSlug}` },
  { name: "Guides", to: `/${marketSlug}/guides` },
  { name: g.value.title, to: `/${marketSlug}/guides/${slug}` },
]);
if (!failed) useSchemaOrg([
  defineBreadcrumb({ itemListElement: crumbs.value.map((c) => ({ name: c.name, item: c.to })) }),
  defineArticle({
    headline: g.value.title,
    description: g.value.teaser,
    image: cover.value ? [photo.url(cover.value.path)] : undefined,
    datePublished: g.value.published_at,
    dateModified: g.value.content_updated_at,
    // Settled 2026-10-03: the byline is "lokl Atlanta"; lokl publishes.
    author: [{ "@type": "Organization", name: byline.value, url: `${siteUrl}/${marketSlug}/guides` }],
    publisher: { "@type": "Organization", name: "lokl", url: siteUrl },
  }),
]);
</script>

<template>
  <div v-if="failed" class="mx-auto max-w-3xl px-4 py-12">
    <UiAlert variant="destructive">
      <UiAlertTitle>This guide didn't load</UiAlertTitle>
      <UiAlertDescription>
        Please try again in a moment, or <NuxtLink :to="`/${marketSlug}/guides`" class="font-medium">see all guides</NuxtLink>.
      </UiAlertDescription>
    </UiAlert>
  </div>
  <article v-else class="mx-auto max-w-6xl px-4 py-8 md:py-12">
    <nav aria-label="Breadcrumb" class="text-muted-foreground mb-4 text-sm">
      <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li v-for="(c, i) in crumbs" :key="c.to" class="flex items-center gap-1.5">
          <NuxtLink v-if="i < crumbs.length - 1" :to="c.to" class="hover:text-foreground">{{ c.name }}</NuxtLink>
          <span v-else aria-current="page" class="text-foreground line-clamp-1">{{ c.name }}</span>
          <Icon v-if="i < crumbs.length - 1" name="lucide:chevron-right" class="size-3.5" aria-hidden="true" />
        </li>
      </ol>
    </nav>

    <div class="mx-auto max-w-3xl">
      <header>
        <h1 class="text-3xl font-semibold tracking-tight md:text-5xl">{{ g.title }}</h1>
        <p class="text-muted-foreground mt-4 text-lg">{{ g.teaser }}</p>
        <p class="mt-4 text-sm">By {{ byline }} · Last updated <time :datetime="g.content_updated_at">{{ updated }}</time></p>
      </header>

      <figure v-if="cover" class="mt-8">
        <NuxtImg :src="photo.url(cover.path)" :srcset="photo.srcset(cover)" sizes="100vw md:768px" :alt="cover.alt"
          :width="cover.width" :height="cover.height" loading="eager" fetchpriority="high" class="h-auto w-full rounded-xl" />
        <figcaption v-if="photoCredit(cover)" class="text-muted-foreground mt-2 text-sm"><PhotoCredit :credit="photoCredit(cover)" /></figcaption>
      </figure>

      <GuideBody :body="g.body" :photos="photos" class="mt-8" />
    </div>

    <GuideListingsBlock :guide="g" :listings="data!.listings" />
  </article>
</template>
