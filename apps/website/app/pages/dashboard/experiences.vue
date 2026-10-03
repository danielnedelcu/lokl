<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "My experiences" });
</script>

<template>
  <ListingList kind="experience" />
</template>
