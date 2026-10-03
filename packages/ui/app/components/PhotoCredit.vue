<script setup lang="ts">
import type { CreditPart } from "@repo/types";

// A guide photo's credit line (photoCredit() in @repo/types), as its
// licence asks: "Photo by {name} on Unsplash" with both links, or the
// credit and licence. Links leave the site, so rel="noopener noreferrer".
defineProps<{ credit: CreditPart[] | null }>();
</script>

<template>
  <span v-if="credit"><template v-for="(part, i) in credit" :key="i"><a
    v-if="part.href" :href="part.href" rel="noopener noreferrer" class="underline underline-offset-4">{{ part.text }}</a><template
    v-else>{{ part.text }}</template></template></span>
</template>
