<script setup lang="ts">
import type { PublicGuidePhoto } from "@repo/types";

// One destination guide as a card: its cover, then the title and teaser
// underneath (never over the photo), all one link. `hero` is the homepage's
// large first guide: wide cover, bigger title, loaded first. Used by the
// homepage, the guides index and the admin's homepage preview.
const props = withDefaults(
  defineProps<{
    href: string;
    title: string;
    teaser: string;
    cover: PublicGuidePhoto;
    hero?: boolean;
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
  <NuxtLink :to="href" :target="external ? '_blank' : undefined" :external="external"
    class="group focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]">
    <div :class="['bg-muted overflow-hidden rounded-xl', hero ? 'aspect-[16/9]' : 'aspect-[4/3]']">
      <NuxtImg :src="src" :srcset="photo.srcset(cover)" :sizes="hero ? '100vw xl:1152px' : sizes"
        :alt="cover.alt" :width="cover.width" :height="cover.height" :loading="priority ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : undefined" class="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
    </div>
    <div :class="hero ? 'mt-4 max-w-3xl' : 'mt-3'">
      <component :is="`h${headingLevel}`"
        :class="[hero ? 'text-2xl font-semibold tracking-tight md:text-4xl' : 'font-medium', 'group-hover:underline']">
        {{ title }}
      </component>
      <p :class="['text-muted-foreground mt-1', hero ? 'text-lg' : 'text-sm']">{{ teaser }}</p>
    </div>
  </NuxtLink>
</template>
