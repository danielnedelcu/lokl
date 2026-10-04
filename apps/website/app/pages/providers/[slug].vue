<script setup lang="ts">
import type { PublicProviderPage } from "@repo/types";

// A provider's public profile, e.g. /providers/peach-tours
// (docs/design/provider-profiles.md, A public profile page): cover, avatar,
// name, headline, "Based in · On lokl since", the bio, then their visible
// Experiences and Services. Only while they can be booked (active, with a
// visible listing); otherwise not found. Cached for up to a minute. Their
// rating and reviews, and a heart to save them, come later.
definePageMeta({ layout: "public" });

const route = useRoute();
const slug = String(route.params.slug);
const { data, error } = await useFetch<PublicProviderPage>(`/api/public/providers/${slug}`, { key: `public-provider-${slug}` });
// Only a real 404 is "not found"; any other failure is a plain message, sent
// as 503 so search engines treat it as temporary.
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, data: { message: "We couldn't find that provider." }, fatal: true });
}
const failed = !!error.value || !data.value;
if (failed && import.meta.server) setResponseStatus(useRequestEvent()!, 503);
const p = computed(() => data.value!.provider);
const market = computed(() => data.value!.market);

const photoUrl = useProviderPhotoUrl();
const since = computed(() =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: market.value?.timezone ?? "America/New_York" }).format(new Date(p.value.since)));
const facts = computed(() => [p.value.market ? `Based in ${p.value.market}` : null, `On lokl since ${since.value}`].filter(Boolean).join(" · "));

const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
const canonical = `${siteUrl}/providers/${slug}`;
if (failed) useSeoMeta({ title: "This profile didn't load", robots: "noindex" });
else {
  const description = (p.value.headline || p.value.bio || `${p.value.name} on lokl.`).slice(0, 155);
  useSeoMeta({
    title: () => (p.value.market ? `${p.value.name} in ${p.value.market}` : p.value.name),
    description,
    ogTitle: () => p.value.name,
    ogDescription: description,
    ogImage: () => photoUrl(p.value.coverPath) ?? photoUrl(p.value.avatarPath) ?? undefined,
    ogUrl: canonical,
    twitterCard: p.value.coverPath ? "summary_large_image" : "summary",
  });
  useHead({ link: [{ rel: "canonical", href: canonical }] });
  // Name and image only: never an address or phone (none are public).
  useSchemaOrg([
    defineLocalBusiness({
      name: p.value.name,
      description: p.value.headline ?? undefined,
      image: photoUrl(p.value.avatarPath) ?? undefined,
      url: canonical,
    }),
  ]);
}
</script>

<template>
  <div v-if="failed" class="mx-auto max-w-3xl px-4 py-12">
    <UiAlert variant="destructive">
      <UiAlertTitle>This profile didn't load</UiAlertTitle>
      <UiAlertDescription>Please try again in a moment.</UiAlertDescription>
    </UiAlert>
  </div>

  <div v-else class="mx-auto max-w-6xl px-4 py-6 md:py-10">
    <!-- The cover: a band, taller on phones. A plain band without one. Decorative. -->
    <div class="bg-muted aspect-[2/1] w-full overflow-hidden rounded-xl sm:aspect-[3/1]">
      <img v-if="p.coverPath" :src="photoUrl(p.coverPath)!" alt="" class="h-full w-full object-cover" fetchpriority="high">
    </div>

    <header class="-mt-10 flex flex-col gap-3 px-2 sm:-mt-12 sm:px-6">
      <div class="ring-background w-fit rounded-full ring-4">
        <ProviderAvatar :name="p.name" :path="p.avatarPath" :size="96" />
      </div>
      <div>
        <!-- Room for later: the rating line, and a heart to save the provider. -->
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">{{ p.name }}</h1>
        <p v-if="p.headline" class="mt-1 text-lg">{{ p.headline }}</p>
        <p class="text-muted-foreground mt-1 text-sm">{{ facts }}</p>
      </div>
    </header>

    <section v-if="p.bio" aria-labelledby="about-heading" class="mt-8 max-w-3xl px-2 sm:px-6">
      <h2 id="about-heading" class="text-lg font-semibold">About {{ p.name }}</h2>
      <p class="mt-2 leading-relaxed whitespace-pre-line">{{ p.bio }}</p>
    </section>

    <section v-for="group in [{ id: 'experiences', title: 'Experiences', items: data!.experiences }, { id: 'services', title: 'Services', items: data!.services }].filter((g) => g.items.length)"
      :key="group.id" :aria-labelledby="`${group.id}-heading`" class="mt-10">
      <h2 :id="`${group.id}-heading`" class="text-lg font-semibold">{{ group.title }} ({{ group.items.length }})</h2>
      <ul class="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="item in group.items" :key="item.id">
          <ListingCard v-if="market" :listing="item" :market="market" />
        </li>
      </ul>
    </section>
  </div>
</template>
