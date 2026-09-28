<script setup lang="ts">
import { payoutSetupOf, type Provider } from "@repo/types";

useHead({ title: "Providers · Admin" });

type ProviderRow = Provider & { city: { name: string; state: string } | null };

const supabase = useSupabaseClient();

// RLS only lets admins read other people's providers, so this is safe client-side.
const { data: providers, error, pending } = await useAsyncData("admin-providers", async () => {
  const { data, error } = await supabase
    .from("providers")
    .select("*, city:cities(name, state)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ProviderRow[];
});

// Sortable by every column. Cells that need a component (badges, dates) are
// filled through the table's `<column id>-cell` slots below.
const columns = [
  { accessorKey: "display_name", header: "Name" },
  {
    id: "city",
    header: "City",
    accessorFn: (p: ProviderRow) => (p.city ? `${p.city.name}, ${p.city.state}` : ""),
  },
  { id: "payouts", header: "Payouts", accessorFn: (p: ProviderRow) => payoutSetupOf(p) },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "created_at", header: "Joined" },
];
watch(error, (e) => e && reportError("Couldn't load providers", e), { immediate: true });
</script>

<template>
  <div>
    <PageHeader
      title="Providers"
      description="Businesses and hosts who sell Services and Experiences, and where each one is in payout setup."
    />

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load providers</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <EmptyState
      v-else-if="!pending && !providers?.length"
      icon="lucide:store"
      title="No providers yet"
      description="Providers appear here once they create a business profile on the website."
    />

    <UiCard v-else class="py-0">
      <UiTanStackTable
        :data="providers ?? []"
        :columns="columns"
        :loading="pending"
        :show-pagination="(providers?.length ?? 0) > 10"
        :show-rows-per-page="(providers?.length ?? 0) > 10"
        :show-page-info="(providers?.length ?? 0) > 10"
        empty-text="No providers yet."
      >
        <template #display_name-cell="{ row }">
          <span class="font-medium">{{ row.original.display_name }}</span>
        </template>
        <template #city-cell="{ row }">
          <span class="text-muted-foreground">{{ row.getValue("city") || "—" }}</span>
        </template>
        <template #payouts-cell="{ row }">
          <StatusBadge kind="payouts" :status="row.getValue('payouts')" />
        </template>
        <template #status-cell="{ row }">
          <StatusBadge kind="provider" :status="row.original.status" />
        </template>
        <template #created_at-cell="{ row }">
          <span class="text-muted-foreground">{{ formatDate(row.original.created_at) }}</span>
        </template>
      </UiTanStackTable>
    </UiCard>
  </div>
</template>
