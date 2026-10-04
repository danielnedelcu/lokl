<script setup lang="ts">
// Sign in or sign up (docs/design/sign-in-with-code.md): the same form as
// the sign-in dialog. Pages that need sign-in send people here; signed in
// by code, they go where they were headed (the module's saved address),
// else to the dashboard. The emailed link does the same through /confirm.
useSeoMeta({ title: "Sign in" });

const redirect = useSupabaseCookieRedirect();
const after = createSignInRedirect({ takeSaved: () => redirect.pluck(), fallback: "/dashboard", go: (path) => navigateTo(path) });

function signedIn(email: string) {
  useSonner.success(`Signed in as ${email}.`);
  after.onUser(true);
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted p-4 text-foreground">
    <UiCard class="w-full max-w-sm">
      <UiCardHeader>
        <UiCardTitle as="h1">Sign in or sign up</UiCardTitle>
        <UiCardDescription>List your services and experiences, and manage bookings.</UiCardDescription>
      </UiCardHeader>
      <UiCardContent>
        <SignInForm :create-user="true" new-account-hint id-prefix="login" @signed-in="signedIn" />
      </UiCardContent>
    </UiCard>
  </div>
</template>
