<script setup lang="ts">
// The Help centre's search (docs/design/website-pages.md): in the browser,
// over every article's title, summary, headings and words; no outside
// service. The query is in the address (?q=), so a search can be shared or
// come back to. Results update as you type; their number is announced.
const route = useRoute();
const router = useRouter();
const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const results = computed(() => searchHelp(HELP_ARTICLES, query.value));
const searching = computed(() => query.value.trim().length > 1);
const found = computed(() => (results.value.length === 1 ? "1 article found." : `${results.value.length} articles found.`));

let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => void router.replace({ query: { ...route.query, q: q.trim() || undefined } }), 300);
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div>
    <form role="search" aria-label="Help articles" @submit.prevent>
      <UiLabel for="help-search" class="mb-2">Search help</UiLabel>
      <UiInput id="help-search" v-model="query" type="search" placeholder="For example: cancel, refund, payouts" autocomplete="off"
        aria-describedby="help-search-hint" class="min-h-11" />
      <p id="help-search-hint" class="text-muted-foreground mt-1.5 text-sm">Results show as you type.</p>
    </form>
    <p class="sr-only" aria-live="polite">{{ searching ? found : "" }}</p>
    <section v-if="searching" class="mt-6" aria-labelledby="help-results-heading">
      <h2 id="help-results-heading" class="text-lg font-semibold">{{ found }}</h2>
      <p v-if="!results.length" class="text-muted-foreground mt-2 text-sm">Try other words, or browse the articles below.</p>
      <ul v-else class="mt-3 space-y-3">
        <li v-for="a in results" :key="a.slug">
          <NuxtLink :to="`/help/${a.slug}`" class="link-text font-medium">{{ a.title }}</NuxtLink>
          <span class="text-muted-foreground"> · {{ HELP_AUDIENCES[a.audience].title }}</span>
          <p class="text-muted-foreground mt-0.5 text-sm">{{ a.summary }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
