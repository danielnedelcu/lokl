<script setup lang="ts">
import type { ListingKind, PublicMarketInfo } from "@repo/types";

// The search's What panel (docs/design/search.md): category pills for both
// kinds, under "Experiences" and "Services", "Anything" first; one choice,
// like browse's category filter. Only categories with live listings.
const props = defineProps<{ info: PublicMarketInfo }>();
const model = defineModel<{ kind?: ListingKind; category?: string }>({ required: true });
const emit = defineEmits<{ chosen: [] }>();
const groups = computed(() => (["experience", "service"] as const)
  .map((kind) => ({ kind, label: kind === "experience" ? "Experiences" : "Services", items: props.info.categories.filter((c) => c.kind === kind && c.count > 0) }))
  .filter((g) => g.items.length));
function pick(kind?: ListingKind, category?: string) {
  model.value = { ...model.value, kind, category };
  emit("chosen");
}
</script>

<template>
  <div class="space-y-5">
    <button type="button" class="search-pill" :aria-pressed="!model.category" @click="pick()"><Icon v-if="!model.category" name="lucide:check" class="mr-1.5 size-4 shrink-0" aria-hidden="true" />Anything</button>
    <div v-for="g in groups" :key="g.kind">
      <p :id="`what-${g.kind}`" class="mb-2 text-sm font-semibold">{{ g.label }}</p>
      <div role="group" :aria-labelledby="`what-${g.kind}`" class="flex flex-wrap gap-2">
        <button v-for="c in g.items" :key="c.slug" type="button" class="search-pill"
          :aria-pressed="model.kind === g.kind && model.category === c.slug" @click="pick(g.kind, c.slug)">
          <Icon v-if="model.kind === g.kind && model.category === c.slug" name="lucide:check" class="mr-1.5 size-4 shrink-0" aria-hidden="true" />{{ c.name }}
        </button>
      </div>
    </div>
  </div>
</template>
