<script setup lang="ts">
import { marketCountFacts, type PageFact, type PublicMarketInfo } from "@repo/types";

// One information page (docs/design/website-pages.md): its Markdown from
// content/pages, with the facts filled in. The Fees page reads the
// commission rates live, About the market's counts; every page can name the
// support address.
const props = defineProps<{ slug: string }>();
const raw = INFO_PAGES[props.slug];
if (!raw) throw createError({ statusCode: 404, data: { message: "We couldn't find that page." }, fatal: true });

// The decided support address (docs/decisions.md) until NUXT_PUBLIC_SUPPORT_EMAIL is set.
const supportEmail = useRuntimeConfig().public.supportEmail || "help@hilokl.com";
const facts: Partial<Record<PageFact, string | null>> = { SUPPORT_EMAIL: supportEmail };
if (raw.includes("{{COMMISSION_")) {
  const { data, error } = await useFetch<{ service: string; experience: string }>("/api/public/fees", { key: "public-fees" });
  if (error.value || !data.value) throw createError({ statusCode: 503, data: { message: "The fees didn't load. Please try again in a moment." }, fatal: true });
  facts.COMMISSION_SERVICE = data.value.service;
  facts.COMMISSION_EXPERIENCE = data.value.experience;
}
if (raw.includes("{{MARKET_")) {
  // The About page's numbers, from the same read as Atlanta's own page.
  const { data, error } = await useFetch<PublicMarketInfo>("/api/public/markets/atlanta", { key: "public-market-atlanta" });
  if (error.value || !data.value) throw createError({ statusCode: 503, data: { message: "This page didn't load. Please try again in a moment." }, fatal: true });
  // Left out until both reach MARKET_COUNTS_MIN (marketCountFacts).
  Object.assign(facts, marketCountFacts(data.value.categories.length, data.value.areas.filter((a) => a.kind === "neighborhood").length));
}
const page = parseInfoPage(`${props.slug}.md`, raw, facts);
if (page.problems.length) console.error("[info page]", page.problems.join("; "));
useSeoMeta({ title: page.title, description: page.summary });
</script>

<template>
  <article class="mx-auto max-w-2xl px-4 py-8 md:py-12">
    <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">{{ page.title }}</h1>
    <p class="text-muted-foreground mt-2">{{ page.summary }}</p>
    <MarkdownBody :html="page.html" class="mt-6" />
    <p class="text-muted-foreground mt-10 text-sm">Last updated {{ formatCalendarDate(page.updated) }}.</p>
  </article>
</template>
