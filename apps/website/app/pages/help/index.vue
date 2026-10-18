<script setup lang="ts">
// The Help centre (docs/design/website-pages.md): search, then the articles
// for customers and for hosts. Articles are Markdown in content/help.
definePageMeta({ layout: "public" });
useSeoMeta({
  title: "Help centre",
  description: "How booking, cancelling, hosting and getting paid work on lokl, step by step.",
});
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 md:py-12">
    <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Help centre</h1>
    <p class="text-muted-foreground mt-2">How lokl works, step by step, for customers and for hosts.</p>

    <HelpSearch class="mt-8" />

    <div class="mt-10 grid gap-10 md:grid-cols-2">
      <section aria-labelledby="help-customers">
        <h2 id="help-customers" class="text-lg font-semibold">
          <NuxtLink to="/help/customers" class="hover:underline">For customers</NuxtLink>
        </h2>
        <HelpArticleList audience="customers" heading-level="h3" class="mt-4" />
      </section>
      <section aria-labelledby="help-hosts">
        <h2 id="help-hosts" class="text-lg font-semibold">
          <NuxtLink to="/help/hosts" class="hover:underline">For hosts</NuxtLink>
        </h2>
        <HelpArticleList audience="hosts" heading-level="h3" class="mt-4" />
      </section>
    </div>

    <HelpContact class="mt-12" />
  </div>
</template>
