<script setup lang="ts">
import { payoutSetupOf, type Provider } from "@repo/types";

useHead({ title: "Providers · Admin" });

type ProviderRow = Provider & { city: { name: string; state: string } | null };

const supabase = useSupabaseClient();

// RLS only lets admins read other people's providers, so this is safe client-side.
const { data: providers, error, pending, refresh } = await useAsyncData("admin-providers", async () => {
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
  { id: "actions", header: "", enableSorting: false },
];

// Suspending or reinstating, with a reason, through the website: it hides
// their listings, withdraws open requests and checkouts (releasing holds),
// and holds their payouts; all logged in admin_actions.
const call = useWebsiteAdmin();
const target = ref<ProviderRow | null>(null);
const dialogOpen = ref(false);
const busy = ref(false);
const actionError = ref("");
function ask(p: ProviderRow) {
  target.value = p;
  actionError.value = "";
  dialogOpen.value = true;
}
const suspending = computed(() => target.value?.status !== "suspended");
const statusDescription = computed(() => suspending.value
  ? "Their listings are hidden at once. Open requests and unpaid checkouts are withdrawn, and the customers' card holds released. Their payouts are held for you to review. Confirmed bookings stay valid."
  : "Their listings show again and they can take bookings. Payouts held while they were suspended stay held until you release them.");
async function confirmStatus(reason: string, message: string) {
  if (!target.value) return;
  busy.value = true;
  try {
    const r = await call(`providers/${target.value.id}/${suspending.value ? "suspend" : "reinstate"}`, { reason, message: message || undefined });
    useSonner.success(`${target.value.display_name}: ${r.result}. They've been emailed.`);
    dialogOpen.value = false;
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
    await refresh();
  }
}
watch(error, (e) => e && reportProblem("Couldn't load providers", e), { immediate: true });
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
        <template #actions-cell="{ row }">
          <UiButton size="sm" variant="outline" :disabled="busy"
            :aria-label="`${row.original.status === 'suspended' ? 'Reinstate' : 'Suspend'} ${row.original.display_name}`" @click="ask(row.original)">
            {{ row.original.status === "suspended" ? "Reinstate" : "Suspend" }}
          </UiButton>
        </template>
      </UiTanStackTable>
    </UiCard>

    <ReasonDialog v-model:open="dialogOpen"
      :title="suspending ? `Suspend ${target?.display_name}?` : `Reinstate ${target?.display_name}?`"
      :description="statusDescription"
      :confirm-label="suspending ? 'Suspend' : 'Reinstate'" :destructive="suspending" :busy="busy" :error="actionError"
      reason-label="Reason (lokl only)" hint="Kept in the provider's history. Never shown to them."
      message-label="Message to the provider (optional)"
      message-hint="Added to their email. Leave it empty to send the standard email only." @confirm="confirmStatus" />
  </div>
</template>
