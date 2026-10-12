<script setup lang="ts">
import type { HomepageGuide } from "@repo/types";

// The top of the homepage when a main guide is chosen (docs/design/
// destination-guides.md, The homepage; three places since 2026-10-11): the
// main guide alone, full width. The page's h1 (what lokl is) is here for
// screen readers only (no visible headline since 2026-10-11). Used by the
// website's homepage and the admin's preview, which leaves the h1 out so the
// admin page keeps its own headings.
const props = withDefaults(
  defineProps<{
    guide: HomepageGuide;
    /** The page's h1, visually hidden; left out in the admin's preview. */
    headline?: string;
    /** The website's address, when shown outside it (the admin's preview). */
    linkBase?: string;
  }>(),
  { headline: "", linkBase: "" },
);
const href = computed(() => `${props.linkBase}/${props.guide.market}/guides/${props.guide.slug}`);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-6 md:pt-8">
    <h1 v-if="headline" class="sr-only">{{ headline }}</h1>
    <section aria-label="Featured guide">
      <GuideCard :href="href" :title="guide.title" :teaser="guide.teaser" :cover="guide.cover" hero priority
        :heading-level="2" :external="!!linkBase" />
    </section>
  </div>
</template>
