<script setup lang="ts">
import type { ListingKind, PublicListingCard } from "@repo/types";

// What the guide's listings block would show right now: live listings in
// its area and/or category, as a signed-out visitor sees them (the website's
// browse query, through its admin route). Reflects the draft's choices.
const props = defineProps<{ marketId: string; areaId: string | null; categoryId: string | null; kind: ListingKind | null }>();

interface Result {
  total: number;
  items: PublicListingCard[];
  hidden: "area" | "category" | null;
}

const call = useWebsiteAdmin();
const result = ref<Result | null>(null);
const error = ref("");
const loading = ref(false);
const open = ref(false);
let seq = 0;

async function load() {
  const mine = ++seq;
  if (!props.areaId && !props.categoryId) {
    result.value = null;
    error.value = "";
    return;
  }
  loading.value = true;
  try {
    const r = await call<Result>("guide-listings", {
      marketId: props.marketId,
      areaId: props.areaId,
      categoryId: props.categoryId,
      kind: props.kind,
    });
    if (mine === seq) {
      result.value = r;
      error.value = "";
    }
  } catch (e) {
    if (mine === seq) error.value = reportProblem("The matching listings didn't load. Is the website running?", e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}
watch(() => [props.areaId, props.categoryId, props.kind], () => void load(), { immediate: true });
</script>

<template>
  <div class="text-sm" aria-live="polite">
    <p v-if="!areaId && !categoryId" class="text-muted-foreground">Choose an area or a category to see matching listings.</p>
    <p v-else-if="loading && !result" class="text-muted-foreground">Finding matching listings…</p>
    <p v-else-if="error" class="text-destructive flex items-center gap-1">
      <Icon name="lucide:alert-circle" aria-hidden="true" />{{ error }}
      <UiButton size="sm" variant="link" @click="load">Try again</UiButton>
    </p>
    <template v-else-if="result">
      <p v-if="result.hidden" class="flex items-start gap-1">
        <Icon name="lucide:eye-off" class="mt-0.5 shrink-0" aria-hidden="true" />
        This {{ result.hidden }} is hidden from the site, so no listings can match. The block will be hidden.
      </p>
      <p v-else-if="!result.total" class="flex items-start gap-1">
        <Icon name="lucide:info" class="mt-0.5 shrink-0" aria-hidden="true" />
        No live listings match yet. The block will be hidden.
      </p>
      <template v-else>
        <button type="button" class="flex min-h-9 items-center gap-1 font-medium underline-offset-4 hover:underline"
          :aria-expanded="open" @click="open = !open">
          <Icon :name="open ? 'lucide:chevron-down' : 'lucide:chevron-right'" aria-hidden="true" />
          {{ result.total }} live {{ result.total === 1 ? "listing matches" : "listings match" }}
        </button>
        <ul v-if="open" class="mt-1 space-y-1 pl-5">
          <li v-for="l in result.items" :key="l.id">
            <NuxtLink :to="`/listings/${l.id}`" class="underline-offset-4 hover:underline">{{ l.title }}</NuxtLink>
            <span class="text-muted-foreground"> · {{ l.category.name }}</span>
          </li>
          <li v-if="result.total > result.items.length" class="text-muted-foreground">
            and {{ result.total - result.items.length }} more
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
