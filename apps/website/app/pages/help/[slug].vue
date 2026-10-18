<script setup lang="ts">
// One Help centre article (docs/design/website-pages.md), rendered from its
// Markdown with raw HTML switched off (helpArticle.ts).
definePageMeta({ layout: "public" });
const route = useRoute();
const article = helpArticle(String(route.params.slug));
if (!article) throw createError({ statusCode: 404, data: { message: "We couldn't find that help article." }, fatal: true });
const audience = HELP_AUDIENCES[article.audience];
const related = helpArticlesFor(article.audience).filter((a) => a.slug !== article.slug);
useSeoMeta({ title: article.title, description: article.summary });
</script>

<template>
  <article class="mx-auto max-w-2xl px-4 py-8 md:py-12">
    <UiBreadcrumbs class="text-muted-foreground"
      :items="[{ label: 'Help centre', link: '/help' }, { label: audience.title, link: audience.path }, { label: article.title }]" />
    <h1 class="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">{{ article.title }}</h1>
    <p class="text-muted-foreground mt-2">{{ article.summary }}</p>

    <MarkdownBody :html="article.html" class="mt-6" />

    <p class="text-muted-foreground mt-10 text-sm">Last updated {{ formatCalendarDate(article.updated) }}.</p>

    <section v-if="related.length" aria-labelledby="related-heading" class="border-border mt-10 border-t pt-8">
      <h2 id="related-heading" class="text-lg font-semibold">More {{ audience.title.toLowerCase() }}</h2>
      <ul class="mt-3 space-y-2">
        <li v-for="a in related" :key="a.slug"><NuxtLink :to="`/help/${a.slug}`" class="link-text">{{ a.title }}</NuxtLink></li>
      </ul>
    </section>

    <HelpContact class="mt-10" />
  </article>
</template>
