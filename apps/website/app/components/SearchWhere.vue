<script setup lang="ts">
import type { PublicMarketInfo } from "@repo/types";

// The search's Where panel (docs/design/search.md): a market's areas as
// pills in columns, "Anywhere" first; one choice, like browse's area filter.
// With several markets, each will be a column headed by its name. Pills are
// buttons with aria-pressed, not radios: the Navigation Menu's panel moves
// focus with the arrow keys, which a radio group's own arrow keys would fight.
defineProps<{ info: PublicMarketInfo }>();
const area = defineModel<string | undefined>();
const emit = defineEmits<{ chosen: [] }>();
function pick(id: string) {
  area.value = id || undefined;
  emit("chosen");
}
</script>

<template>
  <div>
    <p :id="`where-${info.market.slug}`" class="mb-3 text-sm font-semibold">{{ info.market.name }}</p>
    <div role="group" :aria-labelledby="`where-${info.market.slug}`" class="grid grid-cols-2 justify-items-start gap-2 sm:grid-cols-3">
      <button type="button" class="search-pill col-span-2 sm:col-span-3" :aria-pressed="!area" @click="pick('')">
        <Icon v-if="!area" name="lucide:check" class="mr-1.5 size-4 shrink-0" aria-hidden="true" />Anywhere in {{ info.market.name }}
      </button>
      <button v-for="a in info.areas" :key="a.id" type="button" class="search-pill" :aria-pressed="area === a.id" @click="pick(a.id)">
        <Icon v-if="area === a.id" name="lucide:check" class="mr-1.5 size-4 shrink-0" aria-hidden="true" />{{ a.name }}
      </button>
    </div>
  </div>
</template>
