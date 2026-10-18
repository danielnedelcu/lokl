<script setup lang="ts">
// "Still need help?" under the Help centre's pages: the support address
// (when set), and, for hosts, problem reports in the dashboard.
const supportEmail = useRuntimeConfig().public.supportEmail;
</script>

<template>
  <section aria-labelledby="help-contact-heading" class="bg-muted rounded-lg p-5">
    <h2 id="help-contact-heading" class="font-semibold">Still need help?</h2>
    <p v-if="supportEmail" class="mt-2 text-sm">Email us at <a :href="`mailto:${supportEmail}`" class="link-text">{{ supportEmail }}</a>.</p>
    <p class="mt-2 text-sm">
      Hosting on lokl? <NuxtLink to="/dashboard/help/new" class="link-text">Report a problem from your dashboard</NuxtLink>, and follow it there.
    </p>
    <p class="text-muted-foreground mt-2 text-sm">If anyone is in danger, call 911.</p>
  </section>
</template>
