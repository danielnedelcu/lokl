<script setup lang="ts">
definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Edit listing" });

const route = useRoute();
</script>

<template>
  <ListingEditor :key="String(route.params.id)" :listing-id="String(route.params.id)" />
</template>
