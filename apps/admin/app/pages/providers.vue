<script setup lang="ts">
import { payoutSetupOf, type PayoutSetup, type Provider } from "@repo/types";

const supabase = useSupabaseClient();

// RLS only lets admins read other people's providers, so this is safe client-side.
const { data: providers, error } = await useAsyncData("admin-providers", async () => {
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Provider[];
});

const payoutLabel: Record<PayoutSetup, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  ready: "Ready",
};

const payoutIcon: Record<PayoutSetup, string> = {
  not_started: "lucide:circle",
  in_progress: "lucide:clock",
  ready: "lucide:circle-check",
};
</script>

<template>
  <div>
    <PageHeader
      title="Providers"
      description="Businesses and hosts who sell Services and Experiences, and where each one is in Stripe payout setup."
    />

    <p v-if="error" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      Couldn't load providers: {{ error.message }}
    </p>

    <EmptyState
      v-else-if="!providers?.length"
      icon="lucide:store"
      title="No providers yet"
      description="Providers appear here once they create a business profile on the website."
    />

    <div v-else class="overflow-x-auto rounded-lg border border-border bg-surface">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-border text-ink-muted">
          <tr>
            <th scope="col" class="px-4 py-2.5 font-medium">Name</th>
            <th scope="col" class="px-4 py-2.5 font-medium">City</th>
            <th scope="col" class="px-4 py-2.5 font-medium">Payouts</th>
            <th scope="col" class="px-4 py-2.5 font-medium">Status</th>
            <th scope="col" class="px-4 py-2.5 font-medium">Joined</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in providers" :key="p.id" class="border-b border-border last:border-0">
            <td class="px-4 py-3 font-medium">{{ p.display_name }}</td>
            <td class="px-4 py-3 text-ink-muted">{{ p.city || "—" }}</td>
            <td class="px-4 py-3">
              <span class="inline-flex items-center gap-1.5">
                <Icon :name="payoutIcon[payoutSetupOf(p)]" class="size-4" aria-hidden="true" />
                {{ payoutLabel[payoutSetupOf(p)] }}
              </span>
            </td>
            <td class="px-4 py-3 capitalize">{{ p.status }}</td>
            <td class="px-4 py-3 text-ink-muted">{{ new Date(p.created_at).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
