<script setup lang="ts">
// A public experience page (docs/design/browse-and-listing-pages.md). Not cached,
// so a listing taken down disappears from here at once.
definePageMeta({ layout: "public" });
</script>

<template>
  <PublicListing kind="experience" />
</template>
