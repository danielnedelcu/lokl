<script setup lang="ts">
import type { Listing, ListingKind } from "@repo/types";

const props = defineProps<{ kind: ListingKind }>();

const copy = {
  service: {
    title: "My services",
    intro: "The services you offer, the areas you cover, and your prices.",
    create: "Create a Service",
    emptyTitle: "You haven't created any Services yet.",
    emptyBody: "Create your first one to start getting booking requests.",
  },
  experience: {
    title: "My experiences",
    intro: "Experiences you host. Each one is reviewed by lokl before it goes live.",
    create: "Create an Experience",
    emptyTitle: "You haven't created any Experiences yet.",
    emptyBody: "Create your first one and send it to lokl for review.",
  },
}[props.kind];

const supabase = useSupabaseClient();
const { data: provider } = await useProvider();

// Filter to this provider: the public read rule also returns other
// providers' live listings.
const { data: listings, error, pending, refresh } = await useAsyncData(
  `my-listings-${props.kind}`,
  async () => {
    if (!provider.value) return [];
    const { data, error } = await supabase
      .from("listings")
      .select("*, category:categories(name)")
      .eq("provider_id", provider.value.id)
      .eq("kind", props.kind)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data as (Listing & { category: { name: string } | null })[];
  },
  { watch: [provider] },
);

// Statuses change when lokl reviews a listing: refresh on tab focus and when
// a notification arrives for any of them.
useLiveData({ refresh, listings: "any" });
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ copy.title }}</h1>
        <p class="text-muted-foreground mt-1 text-sm">{{ copy.intro }}</p>
      </div>
      <UiButton v-if="provider" :to="`/dashboard/listings/new?kind=${kind}`">{{ copy.create }}</UiButton>
    </div>

    <UiAlert v-if="!provider" class="mt-6">
      <UiAlertTitle>Set up your business profile first</UiAlertTitle>
      <UiAlertDescription>
        Listings belong to your business.
        <NuxtLink to="/dashboard/settings" class="font-medium">Go to your business profile</NuxtLink>
      </UiAlertDescription>
    </UiAlert>

    <UiAlert v-else-if="error" variant="destructive" class="mt-6">
      <UiAlertTitle>Your listings didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>

    <div v-else-if="pending" class="mt-6 space-y-3" aria-busy="true" aria-label="Loading your listings">
      <UiSkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
    </div>

    <div v-else-if="!listings?.length" class="border-border bg-card mt-6 rounded-lg border border-dashed p-8 text-center">
      <p class="font-medium">{{ copy.emptyTitle }}</p>
      <p class="text-muted-foreground mt-1 text-sm">{{ copy.emptyBody }}</p>
    </div>

    <ul v-else class="mt-6 space-y-3">
      <li v-for="l in listings" :key="l.id">
        <NuxtLink
          :to="`/dashboard/listings/${l.id}`"
          class="border-border bg-card hover:border-muted-foreground focus-visible:ring-ring/50 block rounded-lg border p-4 outline-none focus-visible:ring-[3px]"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <p class="font-medium">{{ l.title }}</p>
            <StatusBadge kind="listing" :status="l.status" />
          </div>
          <p class="text-muted-foreground mt-1 text-sm">
            {{ formatMoney(l.price_cents, l.currency) }}{{ kind === "experience" ? " per person" : "" }}
            <template v-if="l.category"> · {{ l.category.name }}</template>
          </p>
          <p class="text-muted-foreground mt-1 text-xs">Last changed {{ formatDate(l.updated_at) }}</p>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
