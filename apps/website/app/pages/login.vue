<script setup lang="ts">
import { signInSchema, type SignInInput } from "@repo/types";

useSeoMeta({ title: "Sign in" });

const supabase = useSupabaseClient();

const { handleSubmit, isSubmitting } = useForm<SignInInput>({
  validationSchema: zodSchema(signInSchema),
});

const sentTo = ref("");
const errorMessage = ref("");

// Creates the account on first sign-in, so this doubles as provider sign-up.
const signIn = handleSubmit(async ({ email }) => {
  errorMessage.value = "";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/confirm` },
  });
  if (error) {
    errorMessage.value = error.message;
    return;
  }
  sentTo.value = email;
  useSonner.success("Sign-in link sent.");
});
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted p-4 text-foreground">
    <UiCard class="w-full max-w-sm">
      <UiCardHeader>
        <UiCardTitle as="h1">Sign in or sign up</UiCardTitle>
        <UiCardDescription>List your services and experiences, and manage bookings.</UiCardDescription>
      </UiCardHeader>

      <UiCardContent>
        <p v-if="sentTo" class="text-sm" role="status">
          Check <strong>{{ sentTo }}</strong> for a sign-in link.
        </p>

        <form v-else class="space-y-4" novalidate @submit="signIn">
          <UiVeeInput name="email" type="email" label="Email" autocomplete="email" required />
          <UiAlert v-if="errorMessage" variant="destructive">
            <UiAlertDescription>{{ errorMessage }}</UiAlertDescription>
          </UiAlert>
          <UiButton type="submit" class="w-full" :disabled="isSubmitting">
            {{ isSubmitting ? "Sending…" : "Email me a sign-in link" }}
          </UiButton>
        </form>
      </UiCardContent>
    </UiCard>
  </div>
</template>
