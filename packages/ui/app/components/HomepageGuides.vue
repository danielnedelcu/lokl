<script setup lang="ts">
import type { HomepageGuide } from "@repo/types";

// The top of the homepage when guides are featured (docs/design/destination-
// guides.md, The homepage): the hero guide (position 1) full width, then up
// to four smaller cards, four across on wide screens, two on tablets,
// stacked on phones. Used by the website's homepage and the admin's preview.
const props = withDefaults(
  defineProps<{
    guides: HomepageGuide[];
    heading?: string;
    /** The website's address, when shown outside it (the admin's preview). */
    linkBase?: string;
  }>(),
  { heading: "Guides to Atlanta", linkBase: "" },
);
const hero = computed(() => props.guides[0]);
const rest = computed(() => props.guides.slice(1, 5));
const href = (g: HomepageGuide) => `${props.linkBase}/${g.market}/guides/${g.slug}`;
</script>

<template>
  <section v-if="hero" aria-labelledby="home-guides-heading" class="mx-auto max-w-6xl px-4 pt-8 md:pt-12">
    <h2 id="home-guides-heading" class="text-muted-foreground mb-4 text-sm font-medium tracking-wide uppercase">{{ heading }}</h2>
    <GuideCard :href="href(hero)" :title="hero.title" :teaser="hero.teaser" :cover="hero.cover" hero priority :external="!!linkBase" />
    <ul v-if="rest.length" class="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="g in rest" :key="g.slug">
        <GuideCard :href="href(g)" :title="g.title" :teaser="g.teaser" :cover="g.cover" :external="!!linkBase" />
      </li>
    </ul>
  </section>
</template>
