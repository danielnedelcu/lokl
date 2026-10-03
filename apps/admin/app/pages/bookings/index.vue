<script setup lang="ts">
import { ADMIN_BOOKING_FIELDS, payoutState, wasCharged, whenOf, withFinances, type AdminBookingRow } from "~/utils/bookingAdmin";

// Bookings & payouts (docs/design/booking-and-checkout.md, Admin): what
// needs attention first, then every booking with its money split and payout.
// Read through RLS (admins read all); actions are on each booking's page.
useHead({ title: "Bookings & payouts · Admin" });
const supabase = useSupabaseClient();

const { data, error, pending, refresh } = await useAsyncData("admin-bookings", async () => {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [bookings, failedEmails, failedRuns] = await Promise.all([
    supabase.from("bookings").select(ADMIN_BOOKING_FIELDS).neq("status", "pending_payment").order("created_at", { ascending: false }).limit(1000),
    supabase.from("booking_emails").select("id, booking_id, kind, last_error, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(100),
    supabase.from("job_runs").select("id, job, finished_at, failed, failures, error").gte("finished_at", since).or("failed.gt.0,error.not.is.null").order("finished_at", { ascending: false }).limit(50),
  ]);
  for (const r of [bookings, failedEmails, failedRuns]) if (r.error) throw r.error;
  return {
    bookings: ((bookings.data ?? []) as any[]).map((b) => withFinances(b)) as AdminBookingRow[],
    failedEmails: failedEmails.data ?? [],
    failedRuns: failedRuns.data ?? [],
  };
});
watch(error, (e) => e && reportProblem("Couldn't load bookings", e), { immediate: true });

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

const all = computed(() => data.value?.bookings ?? []);
const attention = computed(() => {
  const b = all.value;
  return [
    { key: "reports", label: "Reported no-shows to resolve", rows: b.filter((x) => x.problem_reported_at && !x.problem_resolution && x.status !== "cancelled") },
    { key: "holds", label: "Payouts held", rows: b.filter((x) => x.payout_hold && x.payout_hold !== "problem_reported" && !["paid_out", "cancelled"].includes(x.status)) },
    { key: "owed", label: "Reversals that failed (money owed)", rows: b.filter((x) => x.reversal_failed_at) },
    { key: "disputes", label: "Open disputes", rows: b.filter((x) => x.disputed_at && !x.dispute_closed_at) },
    {
      key: "unavailable", label: "Confirmed on a listing that came down, or a suspended provider",
      rows: b.filter((x) => x.status === "confirmed" && (x.listing?.status !== "live" || x.provider?.status === "suspended")),
    },
  ];
});
const attentionCount = computed(() =>
  attention.value.reduce((n, a) => n + a.rows.length, 0) + (data.value?.failedEmails.length ?? 0) + (data.value?.failedRuns.length ?? 0));

// ---------------------------------------------------------------------------
// Every booking, filtered
// ---------------------------------------------------------------------------

const filters = reactive({ status: "", kind: "", provider: "", from: "", to: "", q: "" });
// The date filter as one range (DateRangePicker), kept in filters.from and filters.to.
const dateRange = computed({
  get: () => ({ start: filters.from, end: filters.to }),
  set: (r: { start: string; end: string }) => Object.assign(filters, { from: r.start, to: r.end }),
});
const providers = computed(() => [...new Map(all.value.map((b) => [b.provider_id, b.provider?.display_name ?? "?"])).entries()].sort((a, b) => a[1].localeCompare(b[1])));
// The search box matches any text the table shows for a booking: listing,
// provider, customer, when, status (as its badge reads), amounts and payout.
const searchText = (b: AdminBookingRow) =>
  [
    b.listing?.title,
    b.provider?.display_name,
    b.customer_name,
    whenOf(b),
    statusLabel("adminBooking", b.status),
    b.kind === "experience" ? "Experience" : "Service",
    money(b.total_cents),
    wasCharged(b) ? `${money(b.commission_cents)} ${money(b.provider_amount_cents)}` : "Not charged On hold",
    b.refunded_cents ? `${money(b.refunded_cents)} refunded` : "",
    payoutState(b),
  ].join(" ").toLowerCase();
const query = computed(() => filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean));
const shown = computed(() => all.value.filter((b) =>
  (!query.value.length || query.value.every((word) => searchText(b).includes(word)))
  && (!filters.status || b.status === filters.status)
  && (!filters.kind || b.kind === filters.kind)
  && (!filters.provider || b.provider_id === filters.provider)
  && (!filters.from || (b.starts_at ?? b.created_at) >= filters.from)
  && (!filters.to || (b.starts_at ?? b.created_at).slice(0, 10) <= filters.to)));
const money = (cents: number) => formatMoney(cents, "usd");

// Every booking, in ui-thing's TanStack table (docs/frontend.md): sortable
// columns; money columns sort by what was charged (never-charged bookings last).
const right = { meta: { class: { th: "text-right", td: "text-right" } } };
const charged = (b: AdminBookingRow, cents: number) => (wasCharged(b) ? cents : -1);
const columns = [
  { id: "booking", header: "Booking", accessorFn: (b: AdminBookingRow) => b.listing?.title ?? "Booking" },
  { id: "when", header: "When", accessorFn: (b: AdminBookingRow) => b.starts_at ?? b.created_at },
  { accessorKey: "status", header: "Status" },
  { id: "charged", header: "Charged", accessorFn: (b: AdminBookingRow) => charged(b, b.total_cents), ...right },
  { id: "commission", header: "Commission", accessorFn: (b: AdminBookingRow) => charged(b, b.commission_cents), ...right },
  { id: "providerAmount", header: "Provider", accessorFn: (b: AdminBookingRow) => charged(b, b.provider_amount_cents), ...right },
  { id: "payout", header: "Payout", accessorFn: (b: AdminBookingRow) => payoutState(b) },
];
// Only what was actually charged: requests that were never accepted only
// held the card. Commission is what lokl keeps after refunds.
const totals = computed(() => shown.value.filter(wasCharged).reduce(
  (t, b) => ({
    total: t.total + b.total_cents,
    commission: t.commission + (b.refunded_cents >= b.total_cents ? 0 : b.commission_cents),
    refunded: t.refunded + b.refunded_cents,
  }),
  { total: 0, commission: 0, refunded: 0 },
));
</script>

<template>
  <div>
    <PageHeader title="Bookings & payouts" description="What needs attention first, then every booking with its money split and payout." />

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load bookings</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <template v-else-if="data">
      <!-- Needs attention -->
      <section class="mb-8 rounded-lg border border-border bg-card p-5" aria-labelledby="attention-heading">
        <div class="flex items-center justify-between gap-2">
          <h2 id="attention-heading" class="font-medium">Needs attention ({{ attentionCount }})</h2>
          <UiButton variant="outline" size="sm" :disabled="pending" @click="refresh()">Refresh</UiButton>
        </div>
        <p v-if="!attentionCount" class="mt-2 text-sm text-muted-foreground">Nothing needs attention.</p>
        <div v-else class="mt-4 space-y-4">
          <div v-for="a in attention.filter((x) => x.rows.length)" :key="a.key">
            <h3 class="text-sm font-medium">{{ a.label }} ({{ a.rows.length }})</h3>
            <ul class="mt-1 space-y-1 text-sm">
              <li v-for="b in a.rows" :key="b.id">
                <NuxtLink :to="`/bookings/${b.id}`" class="underline underline-offset-4">{{ b.listing?.title ?? "Booking" }}</NuxtLink>
                · {{ b.provider?.display_name }} · {{ whenOf(b) }} · {{ payoutState(b) }}
              </li>
            </ul>
          </div>
          <div v-if="data.failedEmails.length">
            <h3 class="text-sm font-medium">Emails that failed ({{ data.failedEmails.length }})</h3>
            <ul class="mt-1 space-y-1 text-sm">
              <li v-for="e in data.failedEmails" :key="e.id">
                <NuxtLink :to="`/bookings/${e.booking_id}`" class="underline underline-offset-4"><code>{{ e.kind }}</code></NuxtLink>
                · {{ formatDate(e.created_at) }} · {{ e.last_error }}
              </li>
            </ul>
          </div>
          <div v-if="data.failedRuns.length">
            <h3 class="text-sm font-medium">Job runs with failures, last 7 days ({{ data.failedRuns.length }})</h3>
            <ul class="mt-1 space-y-1 text-sm">
              <li v-for="r in data.failedRuns" :key="r.id">
                <code>{{ r.job }}</code> · {{ formatDate(r.finished_at) }} ·
                {{ r.error ? `crashed: ${r.error}` : `${r.failed} failed: ${(r.failures ?? []).slice(0, 2).join("; ")}` }}
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Every booking -->
      <section aria-labelledby="all-heading">
        <h2 id="all-heading" class="font-medium">All bookings</h2>
        <form class="mt-3 flex flex-wrap items-end gap-3 text-sm" @submit.prevent>
          <div class="w-44">
            <UiLabel for="filter-status" class="mb-1">Status</UiLabel>
            <SelectInput id="filter-status" v-model="filters.status" :options="[
              { value: '', label: 'Any' },
              ...['requested', 'confirmed', 'completed', 'paid_out', 'cancelled', 'declined', 'expired'].map((s) => ({ value: s, label: s.replace('_', ' ') })),
            ]" />
          </div>
          <div class="w-40">
            <UiLabel for="filter-kind" class="mb-1">Kind</UiLabel>
            <SelectInput id="filter-kind" v-model="filters.kind"
              :options="[{ value: '', label: 'Any' }, { value: 'service', label: 'Service' }, { value: 'experience', label: 'Experience' }]" />
          </div>
          <div class="w-56">
            <UiLabel for="filter-provider" class="mb-1">Provider</UiLabel>
            <SearchSelect id="filter-provider" v-model="filters.provider" placeholder="Any provider" empty-text="No provider matches."
              :options="[{ value: '', label: 'Any provider' }, ...providers.map(([id, name]) => ({ value: id, label: name }))]" />
          </div>
          <div>
            <p class="mb-1 text-sm font-medium" aria-hidden="true">Dates</p>
            <DateRangePicker v-model="dateRange" label="Bookings between" empty-text="Any dates" />
          </div>
          <!-- Right-aligned on wider screens; full width on a phone. -->
          <div class="w-full sm:ml-auto sm:w-64">
            <UiLabel for="filter-search" class="mb-1">Search</UiLabel>
            <UiInput id="filter-search" v-model="filters.q" type="search" placeholder="Listing, name, amount…"
              aria-describedby="filter-search-hint" />
            <p id="filter-search-hint" class="sr-only">Matches any text in the table. Results update as you type.</p>
          </div>
        </form>
        <p class="mt-3 text-sm text-muted-foreground">
          {{ shown.length }} {{ shown.length === 1 ? "booking" : "bookings" }} · {{ money(totals.total) }} charged ·
          {{ money(totals.refunded) }} refunded · {{ money(totals.commission) }} commission kept
        </p>
        <EmptyState v-if="!shown.length" class="mt-4" icon="lucide:receipt" title="No bookings" description="Nothing matches these filters." />
        <UiCard v-else class="mt-3 py-0">
          <UiTanStackTable :data="shown" :columns="columns">
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
          </UiTanStackTable>
        </UiCard>
      </section>
    </template>
  </div>
</template>
