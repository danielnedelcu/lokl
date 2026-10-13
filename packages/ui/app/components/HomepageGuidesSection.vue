<script setup lang="ts">
import type { HomepageGuide } from "@repo/types";

// The homepage's guides section, below "On lokl now" (docs/design/
// destination-guides.md, The homepage; 2026-10-11): fixed text with a link
// to every guide on the left, and the two cards the admin chose on the
// right. On tablets the text sits above the cards; on phones everything
// stacks, text first (the reading order is the order shown). With one card
// the text takes two columns; with none, it's a slim row with the link.
// Used by the website's homepage and the admin's preview.
const props = withDefaults(
  defineProps<{
    cards: HomepageGuide[];
    /** The market's slug and name, for the heading and "See all guides". */
    market: string;
    marketName: string;
    /** The website's address, when shown outside it (the admin's preview). */
    linkBase?: string;
  }>(),
  { linkBase: "" },
);
const shown = computed(() => props.cards.slice(0, 2));
const href = (g: HomepageGuide) => `${props.linkBase}/${g.market}/guides/${g.slug}`;
const textSpan = computed(() => ["lg:col-span-3", "lg:col-span-2", "lg:col-span-1"][shown.value.length]);
const listSpan = computed(() => (shown.value.length === 2 ? "lg:col-span-2" : "lg:col-span-1 lg:grid-cols-1"));
</script>

<template>
  <section aria-labelledby="home-guides-heading" class="border-border border-t">
    <div :class="['mx-auto grid max-w-6xl gap-x-6 gap-y-8 px-4 lg:grid-cols-3', shown.length ? 'py-20 md:py-28' : 'py-16']">
      <div :class="['max-w-xl', textSpan]">
        <h2 id="home-guides-heading" class="text-2xl font-semibold">Guides to {{ marketName }}</h2>
        <p class="mt-2">
          Ideas for what to see, eat and do around the city, with Experiences and Services to book along the way.
        </p>
        <NuxtLink :to="`${linkBase}/${market}/guides`" :target="linkBase ? '_blank' : undefined" :external="!!linkBase"
          class="link-primary mt-4">
          See all guides <Icon name="lucide:arrow-right" aria-hidden="true" />
        </NuxtLink>
      </div>
      <ul v-if="shown.length" :class="['grid gap-x-6 gap-y-10 sm:grid-cols-2', listSpan]">
        <!-- With two cards, the first is the feature card: the photo fills it,
             as tall as the section, with its title over it in white. -->
        <li v-for="(g, i) in shown" :key="g.slug">
          <GuideCard :href="href(g)" :title="g.title" :teaser="g.teaser" :cover="g.cover" :external="!!linkBase"
            :feature="shown.length === 2 && i === 0" sizes="100vw sm:50vw lg:33vw" />
        </li>
      </ul>
    </div>
  </section>
</template>
