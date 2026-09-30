<script setup lang="ts">
import { areaLabel, type ListingKind, type PublicBrowseResult, type PublicMarketInfo } from "@repo/types";

// Browse and category pages (docs/design/browse-and-listing-pages.md):
// /<market>/experiences[/<category>] and /<market>/services[/<category>].
// Filters live in the URL and work without JavaScript: categories are links,
// area and dates are a plain GET form.
const props = defineProps<{ kind: ListingKind }>();
const route = useRoute();
const marketSlug = String(route.params.market);
const categorySlug = route.params.category ? String(route.params.category) : undefined;
const plural = props.kind === "experience" ? "experiences" : "services";
const kindWord = props.kind === "experience" ? "Experiences" : "Services";
const basePath = `/${marketSlug}/${plural}`;
const pagePath = categorySlug ? `${basePath}/${categorySlug}` : basePath;

const q = (name: string) => (typeof route.query[name] === "string" && route.query[name] ? String(route.query[name]) : undefined);
// Malformed values in a hand-edited or old link are ignored, not an error.
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const isId = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);
const filters = computed(() => ({
  area: isId(q("area")),
  from: props.kind === "experience" ? isDate(q("from")) : undefined,
  to: props.kind === "experience" ? isDate(q("to")) : undefined,
  page: Math.max(1, Math.floor(Number(q("page") ?? 1)) || 1),
}));

const notFound = () => createError({ statusCode: 404, statusMessage: "We couldn't find that page.", fatal: true });

const { data: info, error: infoError } = await useFetch<PublicMarketInfo>(`/api/public/markets/${marketSlug}`, {
  key: `public-market-${marketSlug}`,
});
if (infoError.value || !info.value) throw notFound();

const { data: result, error, pending } = await useFetch<PublicBrowseResult>("/api/public/browse", {
  key: `public-browse-${pagePath}`,
  query: computed(() => ({
    market: marketSlug,
    kind: props.kind,
    category: categorySlug,
    area: filters.value.area,
    from: filters.value.from,
    to: filters.value.to,
    page: filters.value.page > 1 ? filters.value.page : undefined,
  })),
});
if (error.value?.statusCode === 404) throw notFound();
// A page number past the last page isn't a page.
if (result.value && filters.value.page > 1 && !result.value.items.length) throw notFound();

const market = computed(() => info.value!.market);
const categories = computed(() => info.value!.categories.filter((c) => c.kind === props.kind && (c.count > 0 || c.slug === categorySlug)));
const category = computed(() => info.value!.categories.find((c) => c.kind === props.kind && c.slug === categorySlug));
const areas = computed(() => info.value!.areas);
const filtering = computed(() => !!(filters.value.area || filters.value.from || filters.value.to));
const pages = computed(() => (result.value ? Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) : 1));

const heading = computed(() => (category.value ? category.value.name : `${kindWord} in ${market.value.name}`));
const intro = computed(() =>
  category.value?.description ||
  (props.kind === "experience"
    ? `Tours, classes and outings hosted by local people across the ${market.value.name} metro.`
    : `Local services across the ${market.value.name} metro, at the provider's place or yours.`),
);
const countLine = computed(() => {
  const n = result.value?.total ?? 0;
  const word = props.kind === "experience" ? (n === 1 ? "Experience" : "Experiences") : n === 1 ? "Service" : "Services";
  return `${n} ${word}`;
});

// Date shortcuts, in the market's time zone.
const today = computed(() => todayIn(market.value.timezone));
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const weekend = computed(() => {
  const d = weekday(today.value);
  if (d === 0) return { from: today.value, to: today.value };
  const saturday = addDays(today.value, 6 - d);
  return { from: d === 6 ? today.value : saturday, to: addDays(saturday, 1) };
});
const next7 = computed(() => ({ from: today.value, to: addDays(today.value, 6) }));
const withQuery = (extra: Record<string, string | undefined>) => ({
  path: pagePath,
  query: Object.fromEntries(Object.entries({ area: filters.value.area, ...extra }).filter(([, v]) => v)),
});
const pageLink = (n: number) => ({
  path: pagePath,
  query: Object.fromEntries(Object.entries({ ...filters.value, page: n > 1 ? String(n) : undefined }).filter(([, v]) => v && v !== 1)),
});

// SEO: category and unfiltered pages are indexed; filtered combinations and
// page 2 onwards aren't, and point to the unfiltered page.
const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
useSeoMeta({
  title: () => (category.value ? `${category.value.name} · ${kindWord} in ${market.value.name}` : `${kindWord} in ${market.value.name}`),
  description: () => intro.value,
  robots: () => (filtering.value || filters.value.page > 1 ? "noindex, follow" : undefined),
});
useHead({ link: [{ rel: "canonical", href: `${siteUrl}${pagePath}` }] });
const crumbs = computed(() => [
  { name: market.value.name, to: `/${marketSlug}` },
  { name: kindWord, to: basePath },
  ...(category.value ? [{ name: category.value.name, to: pagePath }] : []),
]);
useSchemaOrg([defineBreadcrumb({ itemListElement: crumbs.value.map((c) => ({ name: c.name, item: c.to })) })]);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 md:py-10">
    <nav aria-label="Breadcrumb" class="text-muted-foreground mb-4 text-sm">
      <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li v-for="(c, i) in crumbs" :key="c.to" class="flex items-center gap-1.5">
          <NuxtLink v-if="i < crumbs.length - 1" :to="c.to" class="hover:text-foreground underline-offset-4 hover:underline">{{ c.name }}</NuxtLink>
          <span v-else aria-current="page" class="text-foreground">{{ c.name }}</span>
          <Icon v-if="i < crumbs.length - 1" name="lucide:chevron-right" class="size-3.5" aria-hidden="true" />
        </li>
      </ol>
    </nav>

    <header class="max-w-2xl">
      <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">{{ heading }}</h1>
      <p v-if="category" class="text-muted-foreground mt-1 text-sm">{{ kindWord }} in {{ market.name }}</p>
      <p class="mt-2">{{ intro }}</p>
    </header>

    <!-- Categories: links, so each is its own page. -->
    <nav v-if="categories.length" aria-label="Categories" class="mt-6">
      <ul class="flex flex-wrap gap-2">
        <li>
          <NuxtLink :to="basePath" class="border-border hover:bg-accent inline-flex min-h-11 items-center rounded-full border px-4 text-sm"
            :class="!categorySlug && 'bg-primary text-primary-foreground hover:bg-primary border-primary'" :aria-current="!categorySlug ? 'page' : undefined">
            All
          </NuxtLink>
        </li>
        <li v-for="c in categories" :key="c.slug">
          <NuxtLink :to="`${basePath}/${c.slug}`" class="border-border hover:bg-accent inline-flex min-h-11 items-center rounded-full border px-4 text-sm"
            :class="c.slug === categorySlug && 'bg-primary text-primary-foreground hover:bg-primary border-primary'" :aria-current="c.slug === categorySlug ? 'page' : undefined">
            {{ c.name }}<span class="opacity-70">&nbsp;({{ c.count }})</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <!-- Area and dates: a plain form, so it works without JavaScript. -->
    <form method="get" :action="pagePath" class="mt-6 flex flex-wrap items-end gap-3" aria-label="Filter">
      <div class="w-full sm:w-64">
        <UiLabel for="filter-area" class="mb-2">Area</UiLabel>
        <UiNativeSelect id="filter-area" name="area" :model-value="filters.area ?? ''">
          <option value="">Anywhere in {{ market.name }}</option>
          <option v-for="a in areas" :key="a.id" :value="a.id">{{ areaLabel(a, market.name) }}</option>
        </UiNativeSelect>
      </div>
      <template v-if="kind === 'experience'">
        <div>
          <UiLabel for="filter-from" class="mb-2">From</UiLabel>
          <UiInput id="filter-from" name="from" type="date" :model-value="filters.from ?? ''" :min="today" />
        </div>
        <div>
          <UiLabel for="filter-to" class="mb-2">To</UiLabel>
          <UiInput id="filter-to" name="to" type="date" :model-value="filters.to ?? ''" :min="today" />
        </div>
      </template>
      <UiButton type="submit" variant="outline">Show results</UiButton>
      <UiButton v-if="filtering" variant="link" :to="pagePath">Clear filters</UiButton>
    </form>
    <p v-if="kind === 'experience'" class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <span class="text-muted-foreground">Quick dates:</span>
      <NuxtLink :to="withQuery(weekend)" class="underline underline-offset-4">This weekend</NuxtLink>
      <NuxtLink :to="withQuery(next7)" class="underline underline-offset-4">Next 7 days</NuxtLink>
    </p>

    <section aria-labelledby="results-heading" class="mt-8">
      <h2 id="results-heading" class="sr-only">Results</h2>
      <UiAlert v-if="error" variant="destructive">
        <UiAlertTitle>This list didn't load</UiAlertTitle>
        <UiAlertDescription>Please try again in a moment.</UiAlertDescription>
      </UiAlert>
      <template v-else>
        <p class="text-muted-foreground mb-4 text-sm" aria-live="polite">{{ pending ? "Loading…" : countLine }}</p>

        <div v-if="!pending && !result?.items.length" class="border-border rounded-lg border border-dashed p-8 text-center">
          <template v-if="filtering">
            <p class="font-medium">Nothing matches these filters.</p>
            <UiButton class="mt-4" variant="outline" :to="pagePath">Clear filters</UiButton>
          </template>
          <template v-else>
            <p class="font-medium">There are no {{ kindWord }} {{ category ? `in ${category.name} ` : "" }}in {{ market.name }} yet.</p>
            <p class="text-muted-foreground mt-1 text-sm">New ones are added every week.</p>
          </template>
        </div>

        <ul v-else class="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="item in result?.items" :key="item.id">
            <ListingCard :listing="item" :market="market" />
          </li>
        </ul>

        <nav v-if="pages > 1" aria-label="Pages" class="mt-10">
          <ul class="flex flex-wrap justify-center gap-2">
            <li v-for="n in pages" :key="n">
              <NuxtLink :to="pageLink(n)" class="border-border hover:bg-accent inline-flex size-11 items-center justify-center rounded-md border text-sm"
                :class="n === filters.page && 'bg-primary text-primary-foreground border-primary hover:bg-primary'"
                :aria-current="n === filters.page ? 'page' : undefined" :aria-label="`Page ${n}`">
                {{ n }}
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </template>
    </section>
  </div>
</template>
