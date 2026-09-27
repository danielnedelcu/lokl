<script setup lang="ts">
import type { ListingKind } from "@repo/types";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const kind = computed<ListingKind>(() => (route.query.kind === "experience" ? "experience" : "service"));
useSeoMeta({ title: () => (kind.value === "service" ? "New Service" : "New Experience") });
</script>

<template>
  <ListingEditor :key="kind" :kind="kind" />
</template>
