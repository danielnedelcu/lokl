<script setup lang="ts">
// The line under the website's ways of signing in (docs/design/website-pages.md,
// decided 2026-10-17): every booking needs an account, so this is where
// people agree, once, and confirm they're 18 or over. The links open in a
// new tab, so reading them mid-booking doesn't lose the sign-in; the link
// says so, in words and with an icon.
</script>

<template>
  <p class="text-muted-foreground text-sm">
    By continuing, you confirm you're 18 or over and agree to lokl's
    <NuxtLink to="/terms" target="_blank" class="link-text">Terms<span class="sr-only"> (opens in a new tab)</span><Icon name="lucide:external-link" class="ml-0.5 inline size-3.5 align-[-2px]" aria-hidden="true" /></NuxtLink>
    and
    <NuxtLink to="/privacy" target="_blank" class="link-text">Privacy Policy<span class="sr-only"> (opens in a new tab)</span><Icon name="lucide:external-link" class="ml-0.5 inline size-3.5 align-[-2px]" aria-hidden="true" /></NuxtLink>.
  </p>
</template>
