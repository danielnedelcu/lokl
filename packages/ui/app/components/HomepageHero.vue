<script setup lang="ts">
import type { HomepageGuide } from "@repo/types";

// The top of the homepage when a main guide is chosen (docs/design/
// destination-guides.md, The homepage; three places since 2026-10-11): a
// slim headline saying what lokl is, then the main guide alone, full width.
// Used by the website's homepage (the headline is its h1) and the admin's
// preview (a paragraph, so the admin page keeps its own headings).
const props = withDefaults(
  defineProps<{
    guide: HomepageGuide;
    headline: string;
    headlineAs?: "h1" | "p";
    /** The website's address, when shown outside it (the admin's preview). */
    linkBase?: string;
  }>(),
  { headlineAs: "h1", linkBase: "" },
);
const href = computed(() => `${props.linkBase}/${props.guide.market}/guides/${props.guide.slug}`);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-6 md:pt-8">
    <component :is="headlineAs" class="text-lg font-semibold tracking-tight md:text-xl">{{ headline }}</component>
    <section aria-label="Featured guide" class="mt-4 md:mt-6">
      <GuideCard :href="href" :title="guide.title" :teaser="guide.teaser" :cover="guide.cover" hero priority
        :heading-level="2" :external="!!linkBase" />
    </section>
  </div>
</template>
