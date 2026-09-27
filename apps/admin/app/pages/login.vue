<script setup lang="ts">
definePageMeta({ layout: "auth" });

const supabase = useSupabaseClient();
const route = useRoute();

const email = ref("");
const status = ref<"idle" | "sending" | "sent" | "error">("idle");
const errorMessage = ref("");

async function signIn() {
  status.value = "sending";
  const { error } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: {
      // Admins are created by hand in Supabase; never sign up from here.
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/confirm`,
    },
  });
  if (error) {
    status.value = "error";
    errorMessage.value = error.message;
    return;
  }
  status.value = "sent";
}
</script>

<template>
  <div class="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
    <h1 class="text-lg font-semibold">Admin sign in</h1>
    <p class="mt-1 text-sm text-ink-muted">Owner access only.</p>

    <p v-if="route.query.denied" class="mt-4 rounded-md bg-surface-muted p-3 text-sm" role="alert">
      That account doesn't have admin access.
    </p>

    <p v-if="status === 'sent'" class="mt-6 text-sm">
      Check <strong>{{ email }}</strong> for a sign-in link.
    </p>

    <form v-else class="mt-6 space-y-3" @submit.prevent="signIn">
      <label class="block text-sm font-medium" for="email">Email</label>
      <input
        id="email"
        v-model="email"
        type="email"
        required
        autocomplete="email"
        class="w-full rounded-md border border-border px-3 py-2 text-sm"
      >
      <button
        type="submit"
        :disabled="status === 'sending'"
        class="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {{ status === "sending" ? "Sending…" : "Email me a sign-in link" }}
      </button>
      <p v-if="status === 'error'" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
    </form>
  </div>
</template>
