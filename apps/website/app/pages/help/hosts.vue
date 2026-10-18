<script setup lang="ts">
definePageMeta({ layout: "public" });
useSeoMeta({ title: "Help for hosts", description: "Setting up, listing, availability, requests, payouts and reviews on lokl, step by step." });
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8 md:py-12">
    <UiBreadcrumbs class="text-muted-foreground" :items="[{ label: 'Help centre', link: '/help' }, { label: 'For hosts' }]" />
    <h1 class="mt-2 text-2xl font-semibold tracking-tight">Help for hosts</h1>
    <HelpArticleList audience="hosts" class="mt-6" />
    <HelpContact class="mt-12" />
  </div>
</template>
