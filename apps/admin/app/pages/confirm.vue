<script setup lang="ts">
definePageMeta({ layout: "auth" });

const user = useSupabaseUser();
const redirect = useSupabaseCookieRedirect();

watch(
  user,
  () => {
    if (user.value) navigateTo(redirect.pluck() || "/");
  },
  { immediate: true },
);
</script>

<template>
  <p class="text-sm text-muted-foreground">Signing you in…</p>
</template>
