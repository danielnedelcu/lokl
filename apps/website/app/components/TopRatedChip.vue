<script setup lang="ts">
// "Top rated" (2026-10-12): 4.8 or higher from at least 5 published reviews
// (isTopRated in @repo/types; the review rules page explains it). The words
// carry it, not colour; the award icon is decorative, and isn't a star, so
// it isn't confused with the rating's star. If its space is short, the words
// end in "…" on screen; screen readers still read them in full.
</script>

<template>
  <span class="bg-background/95 text-foreground inline-flex min-w-0 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-bold shadow-sm">
    <Icon name="lucide:award" class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="truncate">Top rated</span>
  </span>
</template>
