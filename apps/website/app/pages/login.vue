<script setup lang="ts">
useSeoMeta({ title: "Sign in" });

const supabase = useSupabaseClient();

const email = ref("");
const status = ref<"idle" | "sending" | "sent" | "error">("idle");
const errorMessage = ref("");

async function signIn() {
  status.value = "sending";
  // Creates the account on first sign-in, so this doubles as provider sign-up.
  const { error } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: { emailRedirectTo: `${window.location.origin}/confirm` },
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
  <div class="flex min-h-screen items-center justify-center bg-zinc-50 p-4 text-zinc-900">
    <div class="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
      <h1 class="text-lg font-semibold">Sign in or sign up</h1>
      <p class="mt-1 text-sm text-zinc-500">List your services and experiences, and manage bookings.</p>

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
          class="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
        <button
          type="submit"
          :disabled="status === 'sending'"
          class="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {{ status === "sending" ? "Sending…" : "Email me a sign-in link" }}
        </button>
        <p v-if="status === 'error'" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
      </form>
    </div>
  </div>
</template>
