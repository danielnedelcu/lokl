<script setup lang="ts">
import type { NuxtError } from "#app";

// The website's error page. A 404 (a listing that's not public, or a wrong
// address) says so plainly and offers somewhere to go; nothing hints that a
// draft or a taken-down listing exists.
const props = defineProps<{ error: NuxtError }>();
const notFound = computed(() => props.error.statusCode === 404);
useSeoMeta({ title: () => (notFound.value ? "Not found" : "Something went wrong"), robots: "noindex" });
</script>

<template>
  <NuxtLayout name="public">
    <div class="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">
        {{ notFound ? "We couldn't find that" : "Something went wrong" }}
      </h1>
      <p class="text-muted-foreground mt-3">
        {{ notFound ? (error.statusMessage || "We couldn't find that page.") : "This page didn't load. Please try again in a moment." }}
      </p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <UiButton to="/experiences" @click="clearError({ redirect: '/experiences' })">Browse Experiences</UiButton>
        <UiButton variant="outline" to="/services" @click="clearError({ redirect: '/services' })">Browse Services</UiButton>
      </div>
    </div>
  </NuxtLayout>
</template>
