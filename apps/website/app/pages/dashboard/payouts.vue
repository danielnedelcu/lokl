<script setup lang="ts">
import { payoutSetupOf } from "@repo/types";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const { data: provider } = await useProvider();

const setup = computed(() => (provider.value ? payoutSetupOf(provider.value) : "not_started"));
const busy = ref(false);
const errorMessage = ref("");

async function go(path: string) {
  busy.value = true;
  errorMessage.value = "";
  try {
    const { url } = await $fetch<{ url: string }>(path, { method: "POST" });
    window.location.href = url;
  } catch (e) {
    busy.value = false;
    errorMessage.value = (e as { statusMessage?: string }).statusMessage ?? "Something went wrong. Please try again.";
  }
}

// Coming back from Stripe: pull the latest status rather than waiting for the webhook.
onMounted(async () => {
  if (route.query.stripe === "return" && provider.value?.stripe_account_id) {
    provider.value = await $fetch("/api/provider/stripe/sync", { method: "POST" });
  }
});

const copy = {
  not_started: {
    title: "Get paid with Stripe",
    body: "We use Stripe to send your earnings to your bank account. Setup takes about 5–10 minutes. You'll need your bank details and your SSN or business tax ID.",
    action: "Set up payouts",
  },
  in_progress: {
    title: "Finish setting up payouts",
    body: "Stripe still needs a few details before you can take bookings. You can pick up where you left off.",
    action: "Continue setup",
  },
  ready: {
    title: "Payouts are set up",
    body: "You're ready to take bookings. Earnings are sent to your bank account by Stripe.",
    action: "View payouts in Stripe",
  },
} as const;
</script>

<template>
  <div class="max-w-lg">
    <h1 class="text-2xl font-semibold tracking-tight">Payouts</h1>

    <div v-if="!provider" class="mt-6 rounded-lg border border-zinc-200 bg-white p-5 text-sm">
      <p>Create your business profile first.</p>
      <NuxtLink to="/dashboard/settings" class="mt-3 inline-block font-medium underline">Go to business profile</NuxtLink>
    </div>

    <div v-else class="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
      <p class="flex items-center gap-2 font-medium">
        <Icon
          :name="setup === 'ready' ? 'lucide:circle-check' : setup === 'in_progress' ? 'lucide:clock' : 'lucide:circle'"
          class="size-5"
          aria-hidden="true"
        />
        {{ copy[setup].title }}
      </p>
      <p class="mt-2 text-sm text-zinc-600">{{ copy[setup].body }}</p>

      <button
        type="button"
        :disabled="busy"
        class="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        @click="go(setup === 'ready' ? '/api/provider/stripe/dashboard' : '/api/provider/stripe/onboard')"
      >
        {{ busy ? "Opening Stripe…" : copy[setup].action }}
      </button>
      <p v-if="errorMessage" class="mt-3 text-sm text-red-700" role="alert">{{ errorMessage }}</p>
    </div>
  </div>
</template>
