<script setup lang="ts">
const user = useSupabaseUser();
const redirect = useSupabaseCookieRedirect();

watch(
  user,
  () => {
    if (user.value) navigateTo(redirect.pluck() || "/dashboard");
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-screen items-center justify-center text-sm text-zinc-500">Signing you in…</div>
</template>
