<script setup lang="ts">
import type { PublicGuidePhoto } from "@repo/types";

// One destination guide as a card: its cover, then the title and teaser
// underneath, all one link. The exception is `feature` (the homepage's
// guides section, the first of two cards, 2026-10-12): the photo fills the
// card, as tall as its row, under a 60% black overlay, with the title inside
// in white (at least 5.7:1 over any photo) and no teaser. `hero` is the homepage's
// large first guide: wide cover, bigger title, loaded first. Used by the
// homepage, the guides index and the admin's homepage preview. The hero's
// cover is a fixed 450 pixels tall, cropped to fill (object-cover), so the
// top of the homepage never grows taller than that, however wide the screen.
const props = withDefaults(
  defineProps<{
    href: string;
    title: string;
    teaser: string;
    cover: PublicGuidePhoto;
    hero?: boolean;
    /** The photo fills the card, darkened, with the title over it in white; no teaser. */
    feature?: boolean;
    /** Load first (the hero): not lazy, high priority. */
    priority?: boolean;
    headingLevel?: 2 | 3;
    /** How wide the card is on screen, in NuxtImg's form ("100vw sm:50vw lg:25vw"), so the browser picks the photo size. */
    sizes?: string;
    /** Open in a new tab (the admin's preview links to the website). */
    external?: boolean;
  }>(),
  { headingLevel: 3, sizes: "100vw sm:50vw lg:25vw" },
);
const photo = useGuidePhotoUrl();
const src = computed(() => (props.hero ? photo.url(props.cover.path) : photo.card(props.cover)));
</script>

<template>
  <NuxtLink v-if="feature" :to="href" :target="external ? '_blank' : undefined" :external="external"
    class="group focus-visible:ring-ring/50 relative flex h-full min-h-72 overflow-hidden rounded-xl outline-none focus-visible:ring-[3px]">
    <NuxtImg :src="photo.card(cover)" :srcset="photo.srcset(cover)" :sizes="sizes"
      :alt="cover.alt" :width="cover.width" :height="cover.height" loading="lazy"
      class="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-in-out group-hover:scale-[1.02] motion-reduce:transform-none" />
    <span class="absolute inset-0 bg-black/60" aria-hidden="true" />
    <span class="relative mt-auto p-5 text-left text-white">
      <component :is="`h${headingLevel}`" class="text-2xl font-medium tracking-tight">{{ title }}</component>
    </span>
  </NuxtLink>
  <NuxtLink v-else :to="href" :target="external ? '_blank' : undefined" :external="external"
    class="group focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]">
    <div :class="['bg-muted overflow-hidden rounded-xl', hero ? 'h-[450px] w-full' : 'aspect-[4/3]']">
      <NuxtImg :src="src" :srcset="photo.srcset(cover)" :sizes="hero ? '800px lg:100vw xl:1152px' : sizes"
        :alt="cover.alt" :width="cover.width" :height="cover.height" :loading="priority ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : undefined" class="h-full w-full object-cover transition-transform duration-1000 ease-in-out group-hover:scale-[1.02] motion-reduce:transform-none" />
    </div>
    <div :class="hero ? 'mt-4 max-w-3xl' : 'mt-3'">
      <component :is="`h${headingLevel}`"
        :class="[hero ? 'text-xl font-bold tracking-tight md:text-3xl' : 'font-medium']">
        {{ title }}
      </component>
      <p :class="['text-muted-foreground mt-1', !hero && 'text-sm']">{{ teaser }}</p>
    </div>
  </NuxtLink>
</template>
