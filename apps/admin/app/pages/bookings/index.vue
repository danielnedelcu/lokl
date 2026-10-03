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

const filters = reactive({ status: "", kind: "", provider: "", from: "", to: "" });
const providers = computed(() => [...new Map(all.value.map((b) => [b.provider_id, b.provider?.display_name ?? "?"])).entries()].sort((a, b) => a[1].localeCompare(b[1])));
const shown = computed(() => all.value.filter((b) =>
  (!filters.status || b.status === filters.status)
  && (!filters.kind || b.kind === filters.kind)
  && (!filters.provider || b.provider_id === filters.provider)
  && (!filters.from || (b.starts_at ?? b.created_at) >= filters.from)
  && (!filters.to || (b.starts_at ?? b.created_at).slice(0, 10) <= filters.to)));
const money = (cents: number) => formatMoney(cents, "usd");
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
const selectClass = "border-input bg-background h-9 rounded-md border px-2 text-sm";
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
          <label class="flex flex-col gap-1">Status
            <select v-model="filters.status" :class="selectClass">
              <option value="">Any</option>
              <option v-for="s in ['requested', 'confirmed', 'completed', 'paid_out', 'cancelled', 'declined', 'expired']" :key="s" :value="s">{{ s.replace('_', ' ') }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">Kind
            <select v-model="filters.kind" :class="selectClass">
              <option value="">Any</option><option value="service">Service</option><option value="experience">Experience</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">Provider
            <select v-model="filters.provider" :class="selectClass">
              <option value="">Any</option>
              <option v-for="[id, name] in providers" :key="id" :value="id">{{ name }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">From <input v-model="filters.from" type="date" :class="selectClass"></label>
          <label class="flex flex-col gap-1">To <input v-model="filters.to" type="date" :class="selectClass"></label>
        </form>
        <p class="mt-3 text-sm text-muted-foreground">
          {{ shown.length }} {{ shown.length === 1 ? "booking" : "bookings" }} · {{ money(totals.total) }} charged ·
          {{ money(totals.refunded) }} refunded · {{ money(totals.commission) }} commission kept
        </p>
        <EmptyState v-if="!shown.length" class="mt-4" icon="lucide:receipt" title="No bookings" description="Nothing matches these filters." />
        <div v-else class="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <table class="w-full text-sm">
            <thead class="border-b border-border text-left text-muted-foreground">
              <tr>
                <th class="p-3 font-medium">Booking</th><th class="p-3 font-medium">When</th><th class="p-3 font-medium">Status</th>
                <th class="p-3 text-right font-medium">Charged</th><th class="p-3 text-right font-medium">Commission</th>
                <th class="p-3 text-right font-medium">Provider</th><th class="p-3 font-medium">Payout</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in shown" :key="b.id" class="border-b border-border last:border-0">
                <td class="p-3">
                  <NuxtLink :to="`/bookings/${b.id}`" class="font-medium underline-offset-4 hover:underline">{{ b.listing?.title ?? "Booking" }}</NuxtLink>
                  <span class="block text-xs text-muted-foreground">{{ b.provider?.display_name }} · {{ b.customer_name }}</span>
                </td>
                <td class="p-3 whitespace-nowrap">{{ whenOf(b) }}</td>
                <td class="p-3"><StatusBadge kind="adminBooking" :status="b.status" /></td>
                <template v-if="wasCharged(b)">
                  <td class="p-3 text-right">{{ money(b.total_cents) }}<span v-if="b.refunded_cents" class="block text-xs text-muted-foreground">−{{ money(b.refunded_cents) }} refunded</span></td>
                  <td class="p-3 text-right">{{ money(b.commission_cents) }}</td>
                  <td class="p-3 text-right">{{ money(b.provider_amount_cents) }}</td>
                </template>
                <template v-else>
                  <td class="p-3 text-right text-muted-foreground">
                    {{ b.status === "requested" ? "On hold" : "Not charged" }}
                    <span class="block text-xs">{{ money(b.total_cents) }} {{ b.status === "requested" ? "held" : "was held" }}</span>
                  </td>
                  <td class="p-3 text-right text-muted-foreground">—</td>
                  <td class="p-3 text-right text-muted-foreground">—</td>
                </template>
                <td class="p-3">{{ payoutState(b) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
