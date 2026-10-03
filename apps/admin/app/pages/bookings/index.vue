<script setup lang="ts">
import { payoutState, wasCharged, whenOf, type AdminBookingRow } from "~/utils/bookingAdmin";

// Bookings & payouts (docs/design/booking-and-checkout.md, Admin): what
// needs attention first, then every booking with its money split and payout.
// Both come from the database a page at a time (admin_bookings_page), with
// the search, filters, page and sort in the URL (useServerTable). Actions
// are on each booking's page.
useHead({ title: "Bookings & payouts · Admin" });
const supabase = useSupabaseClient();
const money = (cents: number) => formatMoney(cents, "usd");

// ---------------------------------------------------------------------------
// Needs attention: counts across every booking, each group's 20 newest rows
// ---------------------------------------------------------------------------

const GROUPS = [
  { key: "reports", label: "Reported no-shows to resolve" },
  { key: "holds", label: "Payouts held" },
  { key: "owed", label: "Reversals that failed (money owed)" },
  { key: "disputes", label: "Open disputes" },
  { key: "unavailable", label: "Confirmed on a listing that came down, or a suspended provider" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

const { data: attention, error: attentionError, pending: attentionPending, refresh: refreshAttention } = await useAsyncData("admin-booking-attention", async () => {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [counts, failedEmails, failedRuns, ...groups] = await Promise.all([
    supabase.rpc("admin_bookings_page", { p_with_attention: true, p_page_size: 1 }),
    supabase.from("booking_emails").select("id, booking_id, kind, last_error, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(100),
    supabase.from("job_runs").select("id, job, finished_at, failed, failures, error").gte("finished_at", since).or("failed.gt.0,error.not.is.null").order("finished_at", { ascending: false }).limit(50),
    ...GROUPS.map((g) => supabase.rpc("admin_bookings_page", { p_attention: g.key, p_page_size: 20 })),
  ]);
  for (const r of [counts, failedEmails, failedRuns, ...groups]) if (r.error) throw r.error;
  const totals = ((counts.data as { attention?: Record<GroupKey, number> }).attention ?? {}) as Record<GroupKey, number>;
  return {
    groups: GROUPS.map((g, i) => ({ ...g, count: totals[g.key] ?? 0, rows: asServerPage<AdminBookingRow>(groups[i]!.data, null).rows })),
    failedEmails: failedEmails.data ?? [],
    failedRuns: failedRuns.data ?? [],
  };
});
watch(attentionError, (e) => e && reportProblem("Couldn't load what needs attention", e), { immediate: true });
const attentionCount = computed(() =>
  (attention.value?.groups ?? []).reduce((n, g) => n + g.count, 0) + (attention.value?.failedEmails.length ?? 0) + (attention.value?.failedRuns.length ?? 0));

// ---------------------------------------------------------------------------
// All bookings
// ---------------------------------------------------------------------------

const STATUSES = ["requested", "confirmed", "completed", "paid_out", "cancelled", "declined", "expired"];
const table = useServerTable({
  filters: {
    status: oneOf(...STATUSES),
    kind: oneOf("service", "experience"),
    provider: isUuid,
    from: isDay,
    to: isDay,
    attention: oneOf(...GROUPS.map((g) => g.key)),
  },
  sorts: ["created", "when", "status", "listing", "charged", "commission", "provider_amount"],
  async load({ q, filters, page, sort, desc }, signal) {
    const { data, error } = await supabase
      .rpc("admin_bookings_page", {
        p_q: q || undefined,
        p_status: filters.status,
        p_kind: filters.kind,
        p_provider_id: filters.provider,
        p_from: filters.from,
        p_to: filters.to,
        p_attention: filters.attention,
        p_sort: sort,
        p_desc: desc,
        p_page: page,
      })
      .abortSignal(signal);
    return asServerPage<AdminBookingRow>(data, error);
  },
});
const f = computed(() => table.query.value.filters);
const dateRange = computed({
  get: () => ({ start: f.value.from ?? "", end: f.value.to ?? "" }),
  set: (r: { start: string; end: string }) => table.setFilters({ from: r.start || null, to: r.end || null }),
});
const picker = useProviderPicker(() => f.value.provider);
const attentionLabel = computed(() => GROUPS.find((g) => g.key === f.value.attention)?.label);

async function showGroup(key: GroupKey) {
  await table.setFilters({ attention: key });
  document.getElementById("all-heading")?.scrollIntoView({ behavior: "smooth" });
}
async function refreshAll() {
  await Promise.all([refreshAttention(), table.refresh()]);
}

// Columns sort on the server by their meta.sortKey; money columns by what was
// charged (never-charged bookings last).
const right = { class: { th: "text-right", td: "text-right" } };
const columns = [
  { id: "booking", header: "Booking", meta: { sortKey: "listing" } },
  { id: "when", header: "When", meta: { sortKey: "when" } },
  { accessorKey: "status", header: "Status", meta: { sortKey: "status" } },
  { id: "charged", header: "Charged", meta: { sortKey: "charged", ...right } },
  { id: "commission", header: "Commission", meta: { sortKey: "commission", ...right } },
  { id: "providerAmount", header: "Provider", meta: { sortKey: "provider_amount", ...right } },
  { id: "payout", header: "Payout" },
];
</script>

<template>
  <div>
    <PageHeader title="Bookings & payouts" description="What needs attention first, then every booking with its money split and payout." />

    <!-- Needs attention -->
    <UiAlert v-if="attentionError" variant="destructive" class="mb-8">
      <UiAlertTitle>Couldn't load what needs attention</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <section v-else class="mb-8 rounded-lg border border-border bg-card p-5" aria-labelledby="attention-heading">
      <div class="flex items-center justify-between gap-2">
        <h2 id="attention-heading" class="font-medium">Needs attention ({{ attentionCount }})</h2>
        <UiButton variant="outline" size="sm" :disabled="attentionPending || table.pending.value" @click="refreshAll()">Refresh</UiButton>
      </div>
      <p v-if="attention && !attentionCount" class="mt-2 text-sm text-muted-foreground">Nothing needs attention.</p>
      <div v-else-if="attention" class="mt-4 space-y-4">
        <div v-for="g in attention.groups.filter((x) => x.count)" :key="g.key">
          <h3 class="text-sm font-medium">{{ g.label }} ({{ g.count }})</h3>
          <ul class="mt-1 space-y-1 text-sm">
            <li v-for="b in g.rows" :key="b.id">
              <NuxtLink :to="`/bookings/${b.id}`" class="underline underline-offset-4">{{ b.listing?.title ?? "Booking" }}</NuxtLink>
              · {{ b.provider?.display_name }} · {{ whenOf(b) }} · {{ payoutState(b) }}
            </li>
          </ul>
          <UiButton v-if="g.count > g.rows.length" variant="link" size="sm" class="px-0" @click="showGroup(g.key)">
            Show all {{ g.count }} in the table
          </UiButton>
        </div>
        <div v-if="attention.failedEmails.length">
          <h3 class="text-sm font-medium">Emails that failed ({{ attention.failedEmails.length }})</h3>
          <ul class="mt-1 space-y-1 text-sm">
            <li v-for="e in attention.failedEmails" :key="e.id">
              <NuxtLink :to="`/bookings/${e.booking_id}`" class="underline underline-offset-4"><code>{{ e.kind }}</code></NuxtLink>
              · {{ formatDate(e.created_at) }} · {{ e.last_error }}
            </li>
          </ul>
        </div>
        <div v-if="attention.failedRuns.length">
          <h3 class="text-sm font-medium">Job runs with failures, last 7 days ({{ attention.failedRuns.length }})</h3>
          <ul class="mt-1 space-y-1 text-sm">
            <li v-for="r in attention.failedRuns" :key="r.id">
              <code>{{ r.job }}</code> · {{ formatDate(r.finished_at) }} ·
              {{ r.error ? `crashed: ${r.error}` : `${r.failed} failed: ${(r.failures ?? []).slice(0, 2).join("; ")}` }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Every booking -->
    <section aria-labelledby="all-heading">
      <h2 id="all-heading" class="font-medium" tabindex="-1">All bookings</h2>
      <form class="mt-3 flex flex-wrap items-end gap-3 text-sm" role="search" aria-label="Filter bookings" @submit.prevent>
        <div class="w-44">
          <UiLabel for="filter-status" class="mb-1">Status</UiLabel>
          <SelectInput id="filter-status" :model-value="f.status ?? ''" :options="[
            { value: '', label: 'Any' },
            ...STATUSES.map((s) => ({ value: s, label: statusLabel('adminBooking', s) })),
          ]" @update:model-value="(v) => table.setFilter('status', v)" />
        </div>
        <div class="w-40">
          <UiLabel for="filter-kind" class="mb-1">Kind</UiLabel>
          <SelectInput id="filter-kind" :model-value="f.kind ?? ''"
            :options="[{ value: '', label: 'Any' }, { value: 'service', label: 'Service' }, { value: 'experience', label: 'Experience' }]"
            @update:model-value="(v) => table.setFilter('kind', v)" />
        </div>
        <div class="w-56">
          <UiLabel for="filter-provider" class="mb-1">Provider</UiLabel>
          <SearchSelect id="filter-provider" :model-value="f.provider ?? ''" placeholder="Any provider" empty-text="No provider matches."
            :options="[{ value: '', label: 'Any provider' }]" :search="picker.search" :selected-label="picker.selectedLabel.value"
            @update:model-value="(v) => table.setFilter('provider', v)" />
        </div>
        <div>
          <p class="mb-1 text-sm font-medium" aria-hidden="true">Dates</p>
          <DateRangePicker v-model="dateRange" label="Bookings between" empty-text="Any dates" />
        </div>
        <TableSearch id="filter-search" :value="table.query.value.q" placeholder="Customer, email, listing, amount…"
          hint="Matches a customer's name or email, the listing, the provider or an amount. Results update as you type."
          @search="table.setSearch" />
      </form>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <p class="text-muted-foreground" aria-live="polite">
          {{ table.totalExact.value ? "" : "About " }}{{ table.total.value.toLocaleString("en-US") }}
          {{ table.total.value === 1 ? "booking" : "bookings" }}
        </p>
        <p v-if="attentionLabel" class="flex items-center gap-1">
          <span>Showing only: {{ attentionLabel }}</span>
          <UiButton variant="link" size="sm" class="h-auto px-1" @click="table.setFilter('attention', null)">Show all bookings</UiButton>
        </p>
        <UiButton v-if="table.filtering.value" variant="link" size="sm" class="h-auto px-1" @click="table.clear()">Clear filters</UiButton>
      </div>

      <UiAlert v-if="table.error.value" variant="destructive" class="mt-3">
        <UiAlertTitle>Couldn't load bookings</UiAlertTitle>
        <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
      </UiAlert>
      <EmptyState v-else-if="!table.pending.value && !table.total.value" class="mt-4" icon="lucide:receipt" title="No bookings"
        :description="table.filtering.value ? 'Nothing matches these filters. Try a different search, or clear the filters.' : 'Bookings appear here once customers start booking.'" />
      <UiCard v-else class="mt-3 py-0">
        <ServerTable :rows="table.rows.value" :columns="columns" :total="table.total.value" :page="table.query.value.page"
          :sort="table.query.value.sort" :desc="table.query.value.desc" :pending="table.pending.value"
          @page="table.setPage" @sort="table.setSort">
          <template #booking-cell="{ row }">
            <NuxtLink :to="`/bookings/${row.original.id}`" class="font-medium underline-offset-4 hover:underline">
              {{ row.original.listing?.title ?? "Booking" }}
            </NuxtLink>
            <span class="text-muted-foreground block text-xs">{{ row.original.provider?.display_name }} · {{ row.original.customer_name }}</span>
          </template>
          <template #when-cell="{ row }"><span class="whitespace-nowrap">{{ whenOf(row.original) }}</span></template>
          <template #status-cell="{ row }"><StatusBadge kind="adminBooking" :status="row.original.status" /></template>
          <template #charged-cell="{ row }">
            <template v-if="wasCharged(row.original)">
              {{ money(row.original.total_cents) }}
              <span v-if="row.original.refunded_cents" class="text-muted-foreground block text-xs">−{{ money(row.original.refunded_cents) }} refunded</span>
            </template>
            <span v-else class="text-muted-foreground">
              {{ row.original.status === "requested" ? "On hold" : "Not charged" }}
              <span class="block text-xs">{{ money(row.original.total_cents) }} {{ row.original.status === "requested" ? "held" : "was held" }}</span>
            </span>
          </template>
          <template #commission-cell="{ row }">
            <template v-if="wasCharged(row.original)">{{ money(row.original.commission_cents) }}</template>
            <span v-else class="text-muted-foreground"><span aria-hidden="true">—</span><span class="sr-only">None</span></span>
          </template>
          <template #providerAmount-cell="{ row }">
            <template v-if="wasCharged(row.original)">{{ money(row.original.provider_amount_cents) }}</template>
            <span v-else class="text-muted-foreground"><span aria-hidden="true">—</span><span class="sr-only">None</span></span>
          </template>
          <template #payout-cell="{ row }">{{ payoutState(row.original) }}</template>
        </ServerTable>
      </UiCard>
    </section>
  </div>
</template>
