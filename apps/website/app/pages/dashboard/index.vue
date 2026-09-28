<script setup lang="ts">
import { payoutSetupOf } from "@repo/types";

definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Dashboard" });

const supabase = useSupabaseClient();
const { data: provider } = await useProvider();

// Step 3 is done once any of the provider's listings is live or submitted.
const { data: hasListedSomething, refresh: refreshListed } = await useAsyncData(
  "has-live-or-submitted-listing",
  async () => {
    if (!provider.value) return false;
    const { count, error } = await supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", provider.value.id)
      .in("status", ["live", "submitted"]);
    if (error) throw error;
    return (count ?? 0) > 0;
  },
  { watch: [provider] },
);

// Listings lokl sent back or took down. Until emails exist (docs/TODO.md,
// Notifications), this is how providers find out.
const { data: needsAttention, refresh: refreshAttention } = await useAsyncData(
  "listings-needing-attention",
  async () => {
    if (!provider.value) return [];
    const { data, error } = await supabase
      .from("listings")
      .select("id, title, status")
      .eq("provider_id", provider.value.id)
      .in("status", ["rejected", "unpublished"])
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data as { id: string; title: string; status: "rejected" | "unpublished" }[];
  },
  { watch: [provider] },
);
useLiveData({ refresh: () => Promise.all([refreshListed(), refreshAttention()]), listings: "any" });

const attentionTitle = computed(() => {
  const n = needsAttention.value?.length ?? 0;
  return `${n} ${n === 1 ? "listing needs" : "listings need"} your attention`;
});

const steps = computed(() => [
  { label: "Set up your business profile", to: "/dashboard/settings", done: !!provider.value },
  {
    label: "Connect Stripe to get paid",
    to: "/dashboard/payouts",
    done: !!provider.value && payoutSetupOf(provider.value) === "ready",
  },
  { label: "Create your first listing", to: "/dashboard/services", done: !!hasListedSomething.value },
]);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">
      Welcome{{ provider ? `, ${provider.display_name}` : "" }}
    </h1>
    <UiAlert v-if="needsAttention?.length" variant="destructive" class="mt-6 max-w-lg" icon="lucide:alert-circle">
      <UiAlertTitle as="h2">{{ attentionTitle }}</UiAlertTitle>
      <UiAlertDescription>
        <ul class="mt-1 space-y-1">
          <li v-for="l in needsAttention" :key="l.id">
            <NuxtLink :to="`/dashboard/listings/${l.id}`" class="font-medium underline underline-offset-4">{{ l.title }}</NuxtLink>:
            {{ l.status === "rejected" ? "lokl asked for changes" : "lokl took it down" }}
          </li>
        </ul>
      </UiAlertDescription>
    </UiAlert>

    <p class="mt-1 text-sm text-muted-foreground">Finish these steps to start taking bookings.</p>

    <ol class="mt-6 max-w-lg space-y-3">
      <li v-for="(step, i) in steps" :key="step.to">
        <NuxtLink
          :to="step.to"
          class="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:border-muted-foreground"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium"
            :class="step.done ? 'border-primary bg-primary text-primary-foreground' : 'border-input'"
          >
            <Icon v-if="step.done" name="lucide:check" class="size-4" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="text-sm">
            {{ step.label }}
            <span v-if="step.done" class="text-muted-foreground">(done)</span>
          </span>
          <Icon name="lucide:chevron-right" class="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ol>
  </div>
</template>
