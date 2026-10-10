<script setup lang="ts">
import { whenOf } from "~/utils/bookingAdmin";

// Disputes & refunds (docs/design/booking-and-checkout.md, Admin): disputes
// (chargebacks) from Stripe's webhooks, open first, with their evidence due
// dates and a link to each in Stripe's dashboard; then refunded bookings.
useHead({ title: "Disputes & refunds · Admin" });
const supabase = useSupabaseClient();

// Every open dispute (each has an evidence deadline); closed disputes and
// refunds counted and paged by the database (utils/disputes.ts).
const { data, error, pending } = await useAsyncData("admin-disputes", () => loadDisputes(supabase));
const more = reactive({ closed: [] as any[], refunds: [] as any[] });
watch(data, () => {
  more.closed = [];
  more.refunds = [];
});
const closed = computed(() => [...(data.value?.closed.items ?? []), ...more.closed]);
const refunds = computed(() => [...(data.value?.refunds.items ?? []), ...more.refunds]);
const loadingMore = ref<"" | "closed" | "refunds">("");
async function showMore(which: "closed" | "refunds") {
  loadingMore.value = which;
  try {
    const shown = which === "closed" ? closed.value.length : refunds.value.length;
    const next = await loadDisputes(supabase, { [which]: Math.floor(shown / DISPUTES_PAGE_SIZE) + 1 });
    more[which] = [...more[which], ...next[which].items];
  } catch (e) {
    reportProblem(`Couldn't load more ${which === "closed" ? "closed disputes" : "refunds"}`, e);
  } finally {
    loadingMore.value = "";
  }
}
watch(error, (e) => e && reportProblem("Couldn't load disputes", e), { immediate: true });
const money = (cents: number) => formatMoney(cents ?? 0, "usd");
// The Lokl sandbox until launch, so Stripe's test dashboard.
const stripeLink = (id: string) => `https://dashboard.stripe.com/test/disputes/${id}`;
const why = (b: any) => b.problem_resolution === "refunded" ? "a reported no-show"
  : b.cancelled_by === "admin" ? "cancelled by lokl" : b.cancelled_by === "provider" ? "the provider cancelled"
  : b.cancelled_by === "customer" ? "the customer cancelled" : "a refund in Stripe";
</script>

<template>
  <div>
    <PageHeader title="Disputes & refunds" description="Chargebacks from customers' banks, and every refund lokl has made." />
    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load disputes</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <template v-else-if="data">
      <section aria-labelledby="open-heading">
        <h2 id="open-heading" class="font-medium">Open disputes ({{ data.open.length }})</h2>
        <EmptyState v-if="!data.open.length" class="mt-3" icon="lucide:shield-check" title="No open disputes" description="When a customer's bank disputes a charge, it shows here." />
        <ul v-else class="mt-3 space-y-3">
          <li v-for="d in data.open" :key="d.id" class="rounded-lg border border-border bg-card p-4 text-sm">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <NuxtLink :to="`/bookings/${d.id}`" class="font-medium">{{ d.listing?.title }}</NuxtLink>
              <span class="font-medium">{{ money(d.dispute_amount_cents ?? d.total_cents) }}</span>
            </div>
            <p class="text-muted-foreground">{{ d.provider?.display_name }} · {{ whenOf(d) }} · reason: {{ d.dispute_reason ?? "not given" }}</p>
            <p class="mt-1">
              <template v-if="d.dispute_evidence_due_by">Evidence due <strong>{{ formatDate(d.dispute_evidence_due_by) }}</strong> · </template>
              <a :href="stripeLink(d.stripe_dispute_id)" target="_blank" rel="noopener" class="font-medium">Open in Stripe</a>
            </p>
          </li>
        </ul>
      </section>

      <section v-if="data.closed.total" class="mt-8" aria-labelledby="closed-heading">
        <h2 id="closed-heading" class="font-medium">Closed disputes ({{ data.closed.total }})</h2>
        <ul class="mt-2 space-y-1 text-sm">
          <li v-for="d in closed" :key="d.id">
            <NuxtLink :to="`/bookings/${d.id}`" class="font-medium">{{ d.listing?.title }}</NuxtLink>
            · {{ formatDate(d.dispute_closed_at) }} · {{ d.dispute_outcome }} · {{ money(d.dispute_amount_cents ?? d.total_cents) }}
          </li>
        </ul>
        <UiButton v-if="closed.length < data.closed.total" variant="outline" size="sm" class="mt-3" :disabled="!!loadingMore" @click="showMore('closed')">
          {{ loadingMore === "closed" ? "Loading…" : `Show more closed disputes (${data.closed.total - closed.length} more)` }}
        </UiButton>
      </section>

      <section class="mt-8" aria-labelledby="refunds-heading">
        <h2 id="refunds-heading" class="font-medium">Refunds ({{ data.refunds.total }})</h2>
        <p v-if="!data.refunds.total" class="mt-2 text-sm text-muted-foreground">No refunds yet.</p>
        <ul v-else class="mt-2 space-y-1 text-sm">
          <li v-for="r in refunds" :key="r.id">
            <NuxtLink :to="`/bookings/${r.id}`" class="font-medium">{{ r.listing?.title }}</NuxtLink>
            · {{ money(r.refunded_cents) }} · {{ r.refunded_at ? formatDate(r.refunded_at) : "" }} · {{ why(r) }}
          </li>
        </ul>
        <UiButton v-if="refunds.length < data.refunds.total" variant="outline" size="sm" class="mt-3" :disabled="!!loadingMore" @click="showMore('refunds')">
          {{ loadingMore === "refunds" ? "Loading…" : `Show more refunds (${data.refunds.total - refunds.length} more)` }}
        </UiButton>
      </section>
    </template>
    <p v-else-if="pending" class="text-sm text-muted-foreground">Loading…</p>
  </div>
</template>
