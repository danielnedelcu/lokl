<script setup lang="ts">
import type { PayoutSetup, ProviderStatus } from "@repo/types";

useHead({ title: "Providers · Admin" });

// Providers, a page at a time from the database (admin_providers_page, which
// also gives each owner's email and payout setup), with the search, filters,
// page and sort in the URL (useServerTable).
interface ProviderRow {
  id: string;
  display_name: string;
  status: ProviderStatus;
  created_at: string;
  owner_email: string;
  payout_setup: PayoutSetup;
  city: { name: string; state: string } | null;
}

const supabase = useSupabaseClient();
const { data: cities } = await useAsyncData("admin-provider-cities", async () => {
  const { data, error } = await supabase.from("cities").select("id, name, state").order("sort_order").order("name");
  if (error) throw error;
  return data;
});

const table = useServerTable({
  // not_ready: can't be paid yet (not started or in progress). paid_since:
  // a booking paid on or after that day (the dashboard's active providers).
  filters: { status: oneOf("active", "suspended"), payouts: oneOf("not_started", "in_progress", "ready", "not_ready"), city: isUuid, paid_since: isDay },
  sorts: ["joined", "name", "city", "payouts", "status"],
  async load({ q, filters, page, sort, desc }, signal) {
    const { data, error } = await supabase
      .rpc("admin_providers_page", {
        p_q: q || undefined,
        p_status: filters.status,
        p_payout_setup: filters.payouts,
        p_city_id: filters.city,
        p_paid_since: filters.paid_since,
        p_sort: sort,
        p_desc: desc,
        p_page: page,
      })
      .abortSignal(signal);
    return asServerPage<ProviderRow>(data, error);
  },
});
const f = computed(() => table.query.value.filters);

const columns = [
  { accessorKey: "display_name", header: "Name", meta: { sortKey: "name" } },
  { accessorKey: "owner_email", header: "Owner email" },
  { id: "city", header: "City", meta: { sortKey: "city" } },
  { id: "payouts", header: "Payouts", meta: { sortKey: "payouts" } },
  { accessorKey: "status", header: "Status", meta: { sortKey: "status" } },
  { accessorKey: "created_at", header: "Joined", meta: { sortKey: "joined" } },
  { id: "actions", header: "" },
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
    await table.refresh();
  }
}
const notReadyLabel = "Can't be paid yet";
const paidSinceLabel = computed(() =>
  f.value.paid_since
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${f.value.paid_since}T00:00:00Z`))
    : "");
</script>

<template>
  <div>
    <PageHeader
      title="Providers"
      description="Businesses and hosts who sell Services and Experiences, and where each one is in payout setup."
    />

    <form class="mb-3 flex flex-wrap items-end gap-3 text-sm" role="search" aria-label="Filter providers" @submit.prevent>
      <div class="w-40">
        <UiLabel for="filter-status" class="mb-1">Status</UiLabel>
        <SelectInput id="filter-status" :model-value="f.status ?? ''"
          :options="[{ value: '', label: 'Any' }, { value: 'active', label: statusLabel('provider', 'active') }, { value: 'suspended', label: statusLabel('provider', 'suspended') }]"
          @update:model-value="(v) => table.setFilter('status', v)" />
      </div>
      <div class="w-44">
        <UiLabel for="filter-payouts" class="mb-1">Payout setup</UiLabel>
        <SelectInput id="filter-payouts" :model-value="f.payouts ?? ''" :options="[
          { value: '', label: 'Any' },
          { value: 'not_ready', label: notReadyLabel },
          ...['not_started', 'in_progress', 'ready'].map((s) => ({ value: s, label: statusLabel('payouts', s) })),
        ]" @update:model-value="(v) => table.setFilter('payouts', v)" />
      </div>
      <div v-if="(cities?.length ?? 0) > 1" class="w-44">
        <UiLabel for="filter-city" class="mb-1">City</UiLabel>
        <SelectInput id="filter-city" :model-value="f.city ?? ''"
          :options="[{ value: '', label: 'All cities' }, ...(cities ?? []).map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))]"
          @update:model-value="(v) => table.setFilter('city', v)" />
      </div>
      <TableSearch id="filter-search" :value="table.query.value.q" placeholder="Business or owner email"
        hint="Matches the business name or the owner's email. Results update as you type." @search="table.setSearch" />
    </form>

    <div class="mb-3 flex flex-wrap items-center gap-x-3 text-sm">
      <p class="text-muted-foreground" aria-live="polite">
        {{ table.total.value.toLocaleString("en-US") }} {{ table.total.value === 1 ? "provider" : "providers" }}
      </p>
      <p v-if="f.paid_since" class="flex items-center gap-1">
        <span>Showing only: a booking paid since {{ paidSinceLabel }}, Atlanta time</span>
        <UiButton variant="link" size="sm" class="h-auto px-1" @click="table.setFilter('paid_since', null)">Show all providers</UiButton>
      </p>
      <UiButton v-if="table.filtering.value" variant="link" size="sm" class="h-auto px-1" @click="table.clear()">Clear filters</UiButton>
    </div>

    <UiAlert v-if="table.error.value" variant="destructive">
      <UiAlertTitle>Couldn't load providers</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="!table.pending.value && !table.total.value && !table.filtering.value" icon="lucide:store"
      title="No providers yet" description="Providers appear here once they create a business profile on the website." />
    <EmptyState v-else-if="!table.pending.value && !table.total.value" icon="lucide:search-x"
      title="No providers match these filters" description="Try a different search, or clear the filters." />

    <UiCard v-else class="py-0">
      <ServerTable :rows="table.rows.value" :columns="columns" :total="table.total.value" :page="table.query.value.page"
        :sort="table.query.value.sort" :desc="table.query.value.desc" :pending="table.pending.value"
        @page="table.setPage" @sort="table.setSort">
        <template #display_name-cell="{ row }">
          <span class="font-medium">{{ row.original.display_name }}</span>
        </template>
        <template #owner_email-cell="{ row }">
          <span class="text-muted-foreground">{{ row.original.owner_email }}</span>
        </template>
        <template #city-cell="{ row }">
          <span class="text-muted-foreground">{{ row.original.city ? `${row.original.city.name}, ${row.original.city.state}` : "—" }}</span>
        </template>
        <template #payouts-cell="{ row }">
          <StatusBadge kind="payouts" :status="row.original.payout_setup" />
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
      </ServerTable>
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
