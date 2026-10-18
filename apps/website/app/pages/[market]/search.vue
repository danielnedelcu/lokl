<script setup lang="ts">
import { MAX_SEARCH_DAYS, SEARCH_RANGE_TOO_LONG, readSearch, searchDays, searchEvent, searchPath, type ListingKind, type PublicSearchResult, type SearchFilters } from "@repo/types";

// The header search's results (docs/design/search.md): the address holds the
// filters (/atlanta/search?area=&from=&to=&kind=&category=&page=), the list
// comes through browse's own filtering, paging and counts
// (/api/public/search), and an empty result keeps every filter editable.
// With no kind it's the All view: Experiences, then Services, each with its
// first few results and "See all" (2026-10-16); a kind (or a category, which
// fixes it) is that kind's paged list. Dates filter both kinds (Services by
// their free times), up to 31 days; a longer range (a hand-made link) says so
// instead of searching.
definePageMeta({ layout: "public" });

const route = useRoute();
const { info, marketSlug, marketName, whereValue, whenValue, whatValue, openSearch } = useSearch();
const filters = computed(() => readSearch(route.query));
// "all", or the kind shown.
const view = computed<ListingKind | "all">(() => filters.value.kind ?? "all");
const tooLong = computed(() => !!filters.value.from && !!filters.value.to && searchDays(filters.value.from, filters.value.to) > MAX_SEARCH_DAYS);

const { data: result, error, pending } = await useFetch<PublicSearchResult>("/api/public/search", {
  key: computed(() => `public-search-${route.fullPath}`),
  query: computed(() => ({ market: marketSlug.value, ...filters.value })),
});
if (error.value?.statusCode === 404) throw createError({ statusCode: 404, fatal: true });
if (error.value && !tooLong.value && import.meta.server) setResponseStatus(useRequestEvent()!, 503);
if (result.value?.view !== "all" && result.value && (filters.value.page ?? 1) > 1 && !result.value.items.length) throw createError({ statusCode: 404, fatal: true });
// The shown kind's list (a kind's view), or the two sections (All).
const list = computed(() => (result.value && result.value.view !== "all" ? result.value : null));
const sections = computed(() => (result.value?.view === "all"
  ? (["experience", "service"] as const).map((k) => ({ kind: k, ...(result.value as Extract<PublicSearchResult, { view: "all" }>).sections[k] }))
  : []));
const nothing = computed(() => !!result.value && (list.value ? !list.value.items.length : sections.value.every((s) => !s.total)));

const market = computed(() => result.value?.market ?? info.value?.market);
const kindWord = (k: ListingKind, n: number) => (k === "experience" ? (n === 1 ? "Experience" : "Experiences") : n === 1 ? "Service" : "Services");
const to = (f: SearchFilters) => searchPath(marketSlug.value, f);
// The view switch: links, each keeping the other filters (a category is one kind's, so it goes).
const views = computed(() => (["all", "experience", "service"] as const).map((k) => ({
  view: k,
  label: k === "all" ? "All" : k === "experience" ? "Experiences" : "Services",
  count: k === "all" ? (result.value?.counts.experience ?? 0) + (result.value?.counts.service ?? 0) : result.value?.counts[k] ?? 0,
  href: to({ ...filters.value, kind: k === "all" ? undefined : k, category: undefined, page: undefined }),
})));
const pages = computed(() => (list.value ? Math.max(1, Math.ceil(list.value.total / list.value.pageSize)) : 1));
const noneIn = (k: ListingKind) => `No ${kindWord(k, 2)} ${filters.value.from ? "on these dates" : "match this search"}.`;
// Each filter in use, with the address that removes just it.
const chips = computed(() => [
  filters.value.area && { label: whereValue.value, remove: "Anywhere", href: to({ ...filters.value, area: undefined, page: undefined }) },
  filters.value.from && { label: whenValue.value, remove: "Any dates", href: to({ ...filters.value, from: undefined, to: undefined, page: undefined }) },
  filters.value.category && { label: whatValue.value, remove: "Anything", href: to({ ...filters.value, category: undefined, page: undefined }) },
].filter((c): c is { label: string; remove: string; href: string } => !!c));

// Google Analytics' search event (analytics.ts): the filters as settings and
// how many came back, once per search shown; useAnalytics decides whether
// anything is sent.
const { send } = useAnalytics();
let sentFor = "";
function sendSearch() {
  if (!result.value || pending.value || route.fullPath === sentFor) return;
  sentFor = route.fullPath;
  const f = filters.value;
  send(searchEvent({
    market: marketSlug.value, kind: f.kind, category: f.category, area: f.area, from: f.from, to: f.to,
    results: list.value ? list.value.total : (result.value.counts.experience ?? 0) + (result.value.counts.service ?? 0),
  }));
}
onMounted(sendSearch);
watch(result, sendSearch);

const heading = computed(() => `${view.value === "all" ? "Experiences and Services" : kindWord(view.value, 2)} in ${marketName.value}`);
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

    <!-- The view switch, unless a category has chosen the kind. -->
    <nav v-if="!filters.category" aria-label="Kind" class="mt-6">
      <ul class="flex flex-wrap gap-2">
        <li v-for="v in views" :key="v.view">
          <NuxtLink :to="v.href" class="link-secondary" :aria-current="v.view === view ? 'page' : undefined">
            {{ v.label }}<span class="opacity-70">&nbsp;({{ v.count }})</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <section aria-labelledby="results-heading" class="mt-8">
      <h2 id="results-heading" class="sr-only">Results</h2>
      <div v-if="tooLong" class="border-border rounded-lg border border-dashed p-8 text-center">
        <p class="font-medium">{{ SEARCH_RANGE_TOO_LONG }}</p>
        <p class="text-muted-foreground mt-1 text-sm">Search a shorter stretch of dates, up to {{ MAX_SEARCH_DAYS }} days at a time.</p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" class="link-secondary" @click="openSearch('when')">Change the dates</button>
          <NuxtLink :to="to({ ...filters, from: undefined, to: undefined, page: undefined })" class="link-secondary">Any dates</NuxtLink>
        </div>
      </div>
      <UiAlert v-else-if="error" variant="destructive">
        <UiAlertTitle>This list didn't load</UiAlertTitle>
        <UiAlertDescription>Please try again in a moment.</UiAlertDescription>
      </UiAlert>
      <template v-else>
        <p class="text-muted-foreground mb-4 text-sm" aria-live="polite">
          {{ pending ? "Loading…" : list ? `${list.total} ${kindWord(list.view, list.total)}` : "" }}
        </p>

        <!-- Nothing found: the filters stay right here to change. -->
        <div v-if="!pending && nothing" class="border-border rounded-lg border border-dashed p-8 text-center">
          <p class="font-medium">{{ list ? `No ${kindWord(list.view, 2)} match this search.` : "Nothing matches this search." }}</p>
          <p class="text-muted-foreground mt-1 text-sm">Try another area, other dates, or anything.</p>
          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" class="link-secondary" @click="openSearch('where')">Where: {{ whereValue }}</button>
            <button type="button" class="link-secondary" @click="openSearch('when')">When: {{ whenValue }}</button>
            <button type="button" class="link-secondary" @click="openSearch('what')">What: {{ whatValue }}</button>
          </div>
          <NuxtLink v-if="chips.length" :to="to({})" class="link-text mt-4 inline-block text-sm">Clear all filters</NuxtLink>
        </div>

        <!-- All: each kind's first few, then "See all" for that kind's own list. -->
        <div v-else-if="!list" class="space-y-12">
          <section v-for="s in sections" :key="s.kind" :aria-labelledby="`section-${s.kind}`">
            <h2 :id="`section-${s.kind}`" class="text-xl font-semibold">
              {{ kindWord(s.kind, 2) }}<span class="text-muted-foreground font-normal">&nbsp;({{ s.total }})</span>
            </h2>
            <p v-if="!s.total" class="text-muted-foreground mt-3 text-sm">{{ noneIn(s.kind) }}</p>
            <template v-else>
              <ul class="mt-4 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                <li v-for="item in s.items" :key="item.id">
                  <ListingCard v-if="market" :listing="item" :market="market" />
                </li>
              </ul>
              <NuxtLink :to="to({ ...filters, kind: s.kind, page: undefined })" class="link-secondary mt-6">
                See all {{ s.total }} {{ kindWord(s.kind, s.total) }}
              </NuxtLink>
            </template>
          </section>
        </div>

        <ul v-else class="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="item in list.items" :key="item.id">
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
