<script setup lang="ts">
import { readSearch, searchPath, type ListingKind, type PublicSearchResult, type SearchFilters } from "@repo/types";

// The header search's results (docs/design/search.md): the address holds the
// filters (/atlanta/search?area=&from=&to=&kind=&category=&page=), the list
// comes through browse's own filtering, paging and counts
// (/api/public/search), and an empty result keeps every filter editable.
// Dates filter Experiences only; with Services shown, a note says so.
definePageMeta({ layout: "public" });

const route = useRoute();
const { info, marketSlug, marketName, whereValue, whenValue, whatValue, openSearch } = useSearch();
const filters = computed(() => readSearch(route.query));
const kind = computed<ListingKind>(() => filters.value.kind ?? "experience");

const { data: result, error, pending } = await useFetch<PublicSearchResult>("/api/public/search", {
  key: computed(() => `public-search-${route.fullPath}`),
  query: computed(() => ({ market: marketSlug.value, ...filters.value })),
});
if (error.value?.statusCode === 404) throw createError({ statusCode: 404, fatal: true });
if (error.value && import.meta.server) setResponseStatus(useRequestEvent()!, 503);
if (result.value && (filters.value.page ?? 1) > 1 && !result.value.items.length) throw createError({ statusCode: 404, fatal: true });

const market = computed(() => result.value?.market ?? info.value?.market);
const kindWord = (k: ListingKind, n: number) => (k === "experience" ? (n === 1 ? "Experience" : "Experiences") : n === 1 ? "Service" : "Services");
const to = (f: SearchFilters) => searchPath(marketSlug.value, f);
// The kind switch: links, each keeping the other filters (a category is one kind's, so it goes).
const kinds = computed(() => (["experience", "service"] as const).map((k) => ({
  kind: k, label: k === "experience" ? "Experiences" : "Services", count: result.value?.counts[k] ?? 0,
  href: to({ ...filters.value, kind: k, category: undefined, page: undefined }),
})));
const pages = computed(() => (result.value ? Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) : 1));
// Each filter in use, with the address that removes just it.
const chips = computed(() => [
  filters.value.area && { label: whereValue.value, remove: "Anywhere", href: to({ ...filters.value, area: undefined, page: undefined }) },
  filters.value.from && { label: whenValue.value, remove: "Any dates", href: to({ ...filters.value, from: undefined, to: undefined, page: undefined }) },
  filters.value.category && { label: whatValue.value, remove: "Anything", href: to({ ...filters.value, category: undefined, page: undefined }) },
].filter((c): c is { label: string; remove: string; href: string } => !!c));

const heading = computed(() => `${kindWord(kind.value, 2)} in ${marketName.value}`);
useSeoMeta({ title: () => `Search · ${heading.value}`, robots: "noindex, follow" });
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 md:py-10">
    <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">{{ heading }}</h1>

    <!-- What's searched: each filter can be removed on its own. -->
    <ul v-if="chips.length" class="mt-4 flex flex-wrap gap-2" aria-label="Filters">
      <li v-for="c in chips" :key="c.remove">
        <NuxtLink :to="c.href" class="search-pill gap-2" :aria-label="`${c.label}: remove, show ${c.remove}`">
          {{ c.label }}<Icon name="lucide:x" class="size-4" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>

    <!-- The kind switch, unless a category has chosen the kind. -->
    <nav v-if="!filters.category" aria-label="Kind" class="mt-6">
      <ul class="flex flex-wrap gap-2">
        <li v-for="k in kinds" :key="k.kind">
          <NuxtLink :to="k.href" class="link-secondary" :aria-current="k.kind === kind ? 'page' : undefined">
            {{ k.label }}<span class="opacity-70">&nbsp;({{ k.count }})</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <p v-if="result?.datesIgnored" class="bg-muted mt-4 flex max-w-2xl gap-2 rounded-lg p-3 text-sm">
      <Icon name="lucide:info" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Dates apply to Experiences. For Services, you suggest times when you book, so these Services aren't filtered by date.
    </p>

    <section aria-labelledby="results-heading" class="mt-8">
      <h2 id="results-heading" class="sr-only">Results</h2>
      <UiAlert v-if="error" variant="destructive">
        <UiAlertTitle>This list didn't load</UiAlertTitle>
        <UiAlertDescription>Please try again in a moment.</UiAlertDescription>
      </UiAlert>
      <template v-else>
        <p class="text-muted-foreground mb-4 text-sm" aria-live="polite">{{ pending ? "Loading…" : `${result?.total ?? 0} ${kindWord(kind, result?.total ?? 0)}` }}</p>

        <!-- Nothing found: the filters stay right here to change. -->
        <div v-if="!pending && !result?.items.length" class="border-border rounded-lg border border-dashed p-8 text-center">
          <p class="font-medium">No {{ kindWord(kind, 2) }} match this search.</p>
          <p class="text-muted-foreground mt-1 text-sm">Try another area, other dates, or anything.</p>
          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" class="link-secondary" @click="openSearch('where')">Where: {{ whereValue }}</button>
            <button v-if="kind === 'experience'" type="button" class="link-secondary" @click="openSearch('when')">When: {{ whenValue }}</button>
            <button type="button" class="link-secondary" @click="openSearch('what')">What: {{ whatValue }}</button>
          </div>
          <NuxtLink v-if="chips.length" :to="to({})" class="link-text mt-4 inline-block text-sm">Clear all filters</NuxtLink>
        </div>

        <ul v-else class="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="item in result?.items" :key="item.id">
            <ListingCard v-if="market" :listing="item" :market="market" />
          </li>
        </ul>

        <nav v-if="pages > 1" aria-label="Pages" class="mt-10">
          <ul class="flex flex-wrap justify-center gap-2">
            <li v-for="n in pages" :key="n">
              <NuxtLink :to="to({ ...filters, page: n })" class="link-secondary min-w-9 px-3"
                :aria-current="n === (filters.page ?? 1) ? 'page' : undefined" :aria-label="`Page ${n}`">{{ n }}</NuxtLink>
            </li>
          </ul>
        </nav>
      </template>
    </section>
  </div>
</template>
