<script setup lang="ts">
// Where support lands on an owner-only page (the middleware sends them).
const route = useRoute();
const page = computed(() => (typeof route.query.page === "string" ? route.query.page : ""));
useHead({ title: "Only the owner" });
</script>

<template>
  <div class="max-w-xl">
    <PageHeader title="Only the owner can open this page" />
    <p class="mt-2">
      Guides, the homepage, categories, markets and areas, settings and the team are managed by the owner.
      If something there needs changing, ask the owner.
    </p>
    <p v-if="page" class="text-muted-foreground mt-2 text-sm">You tried to open {{ page }}.</p>
    <UiButton class="mt-6 min-h-11" to="/">Back to the dashboard</UiButton>
  </div>
</template>
