<script setup lang="ts">
import { signInSchema, type SignInInput } from "@repo/types";

definePageMeta({ layout: "auth" });
useHead({ title: "Sign in · Admin" });

const supabase = useSupabaseClient();
const route = useRoute();

const { handleSubmit, isSubmitting } = useForm<SignInInput>({
  validationSchema: zodSchema(signInSchema),
});

const sentTo = ref("");
const errorMessage = ref("");

const signIn = handleSubmit(async ({ email }) => {
  errorMessage.value = "";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Admins are created by hand in Supabase; never sign up from here.
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/confirm`,
    },
  });
  if (error) {
    // Unknown addresses get an error too (shouldCreateUser: false), so this
    // doesn't say which it was.
    errorMessage.value = reportProblem(
      "We couldn't send a sign-in link. Check this is an admin's email address, or try again in a minute.",
      error,
    );
    return;
  }
  sentTo.value = email;
  useSonner.success("Sign-in link sent.");
});
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
</template>
