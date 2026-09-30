<script setup lang="ts">
definePageMeta({ layout: "auth" });

// See useSignInConfirm: gives up with a plain message when the link was
// opened in a different browser from the one that requested it.
const { failed } = useSignInConfirm("/");
</script>

<template>
  <div aria-live="polite" class="w-full max-w-sm">
    <p v-if="!failed" class="text-muted-foreground text-center text-sm">Signing you in…</p>
    <UiCard v-else>
      <UiCardHeader>
        <UiCardTitle as="h1">
          {{ failed === "expired" ? "This sign-in link has expired" : "This link didn't work in this browser" }}
        </UiCardTitle>
      </UiCardHeader>
      <UiCardContent class="space-y-4">
        <p v-if="failed === 'expired'" class="text-sm">
          This sign-in link has expired or was already used. Request a new link.
        </p>
        <p v-else class="text-sm">
          This link didn't work in this browser. Sign-in links only work in the browser you requested them from.
          Request a new link here.
        </p>
        <UiButton to="/login" class="w-full">Request a new link</UiButton>
      </UiCardContent>
    </UiCard>
  </div>
</template>
