<script setup lang="ts">
import type { HelpAudience } from "~/utils/helpArticle";

// One audience's articles, in order, each with its summary.
const props = defineProps<{ audience: HelpAudience; headingLevel?: "h2" | "h3" }>();
const articles = computed(() => helpArticlesFor(props.audience));
</script>

<template>
  <ul class="space-y-4">
    <li v-for="a in articles" :key="a.slug">
      <component :is="headingLevel ?? 'h2'" class="font-medium">
        <NuxtLink :to="`/help/${a.slug}`" class="link-text">{{ a.title }}</NuxtLink>
      </component>
      <p class="text-muted-foreground mt-0.5 text-sm">{{ a.summary }}</p>
    </li>
  </ul>
</template>
