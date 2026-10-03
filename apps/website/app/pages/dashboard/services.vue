<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "My services" });
</script>

<template>
  <ListingList kind="service" />
</template>
