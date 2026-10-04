<script setup lang="ts">
// Admin sign in (docs/design/sign-in-with-code.md): the website's form, by
// emailed code or link, without creating accounts (admins are made by hand
// in Supabase). An unknown address gets the same message as any failure.
definePageMeta({ layout: "auth" });
useHead({ title: "Sign in · Admin" });

const route = useRoute();
const redirect = useSupabaseCookieRedirect();
const after = createSignInRedirect({ takeSaved: () => redirect.pluck(), fallback: "/", go: (path) => navigateTo(path) });
</script>

<template>
  <UiCard class="w-full max-w-sm">
    <UiCardHeader>
      <UiCardTitle as="h1">Admin sign in</UiCardTitle>
      <UiCardDescription>Owner access only.</UiCardDescription>
    </UiCardHeader>

    <UiCardContent class="space-y-4">
      <UiAlert v-if="route.query.denied" variant="destructive">
        <UiAlertDescription>That account doesn't have admin access.</UiAlertDescription>
      </UiAlert>

      <SignInForm :create-user="false" admin id-prefix="admin-login" @signed-in="after.onUser(true)" />
    </UiCardContent>
  </UiCard>
</template>
