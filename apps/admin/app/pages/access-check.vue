<script setup lang="ts">
// When the access check itself fails (the database answered with an error,
// not "no role"), say so rather than "doesn't have admin access", and offer
// to try again. Shows nothing admin; the middleware lets it through.
definePageMeta({ layout: "auth" });
useHead({ title: "Couldn't check access · Admin" });

const route = useRoute();
// Where they were going: a path in this app only.
const to = computed(() => {
  const t = typeof route.query.to === "string" ? route.query.to : "/";
  return t.startsWith("/") && !t.startsWith("//") && !t.startsWith("/access-check") ? t : "/";
});
</script>

<template>
  <UiCard class="w-full max-w-sm">
    <UiCardHeader>
      <UiCardTitle as="h1">We couldn't check your access</UiCardTitle>
      <UiCardDescription>Something went wrong on our side. Try again in a moment.</UiCardDescription>
    </UiCardHeader>
    <UiCardContent>
      <UiButton class="min-h-11 w-full" @click="navigateTo(to)">Try again</UiButton>
    </UiCardContent>
  </UiCard>
</template>
