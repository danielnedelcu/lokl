<script setup lang="ts">
import { payoutSetupOf } from "@repo/types";

definePageMeta({ layout: "dashboard" });

const { data: provider } = await useProvider();

const steps = computed(() => [
  { label: "Set up your business profile", to: "/dashboard/settings", done: !!provider.value },
  {
    label: "Connect Stripe to get paid",
    to: "/dashboard/payouts",
    done: !!provider.value && payoutSetupOf(provider.value) === "ready",
  },
  // TODO: mark done once listings exist.
  { label: "Publish your first service or experience", to: "/dashboard/services", done: false },
]);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">
      Welcome{{ provider ? `, ${provider.display_name}` : "" }}
    </h1>
    <p class="mt-1 text-sm text-zinc-500">Finish these steps to start taking bookings.</p>

    <ol class="mt-6 max-w-lg space-y-3">
      <li v-for="(step, i) in steps" :key="step.to">
        <NuxtLink
          :to="step.to"
          class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium"
            :class="step.done ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'"
          >
            <Icon v-if="step.done" name="lucide:check" class="size-4" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="text-sm">
            {{ step.label }}
            <span v-if="step.done" class="text-zinc-500">(done)</span>
          </span>
          <Icon name="lucide:chevron-right" class="ml-auto size-4 text-zinc-400" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ol>
  </div>
</template>
