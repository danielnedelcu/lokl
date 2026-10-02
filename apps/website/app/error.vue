<script setup lang="ts">
import type { NuxtError } from "#app";

// The website's error page. A 404 says so plainly and offers somewhere to go;
// nothing hints that a draft or a taken-down listing exists. The wording is
// generic unless the page passed its own in `data.message` (listing pages and
// bookings do). `statusMessage` is never shown: Nuxt fills it with things like
// "Page not found: /x".
const props = defineProps<{ error: NuxtError<{ message?: string }> }>();
const notFound = computed(() => props.error.statusCode === 404);
const message = computed(() => {
  const own = props.error.data?.message;
  if (notFound.value) return own || "The address may be mistyped, or the page may have moved.";
  return "This page didn't load. Please try again in a moment.";
});
useSeoMeta({ title: () => (notFound.value ? "Not found" : "Something went wrong"), robots: "noindex" });
</script>

<template>
  <NuxtLayout name="public">
    <div class="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">
        {{ notFound ? "We couldn't find that page" : "Something went wrong" }}
      </h1>
      <p class="text-muted-foreground mt-3">{{ message }}</p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <UiButton to="/experiences" @click="clearError({ redirect: '/experiences' })">Browse Experiences</UiButton>
        <UiButton variant="outline" to="/services" @click="clearError({ redirect: '/services' })">Browse Services</UiButton>
      </div>
    </div>
  </NuxtLayout>
</template>
