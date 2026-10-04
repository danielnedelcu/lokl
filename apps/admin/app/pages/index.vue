<script setup lang="ts">
// The admin dashboard (plan approved 2026-10-04): the marketplace's numbers
// from admin_dashboard(), in one call. Each number links to the page behind
// it, filtered the same way, so the page shows the same figure: the money
// cards open Bookings "paid between" the same Atlanta dates (its totals line
// gives the same GMV and commission), active providers open Providers "paid
// since". "Paid" means the payment was recorded (an Experience at checkout,
// a Service when the provider accepted). Commission is before Stripe's fees,
// which aren't stored yet (docs/TODO.md).
useHead({ title: "Dashboard · Admin" });
const supabase = useSupabaseClient();

interface Dashboard {
  time_zone: string;
  today: string;
  paid_from: string;
  active_since: string;
  gmv_cents: number;
  commission_cents: number;
  bookings: number;
  active_providers: number;
  listings_to_review: { experience: number; service: number };
  open_disputes: number;
  bookings_attention: number;
  guide_drafts: number;
  providers_not_payable: number;
}

const { data, error, pending, refresh } = await useAsyncData("admin-dashboard", async () => {
  const { data: d, error: e } = await supabase.rpc("admin_dashboard");
  if (e) throw e;
  return d as unknown as Dashboard;
});
watch(error, (e) => e && reportProblem("Couldn't load the dashboard", e), { immediate: true });
// Reviews with open reports (docs/design/reviews.md), from the Reviews page's own function.
const { data: reviewReports, refresh: refreshReviews } = await useAsyncData("admin-dashboard-review-reports", async () => {
  const { data: d, error: e } = await supabase.rpc("admin_reviews_page", { p_reported: true, p_page_size: 1 });
  if (e) {
    reportProblem("Couldn't count the review reports", e);
    return null;
  }
  return (d as unknown as { open_reports: number }).open_reports;
});
// Fresh numbers when the admin comes back to the tab.
useLiveData({ refresh: () => Promise.all([refresh(), refreshReviews()]) });

// "Sep 5": a calendar day as the database gave it (no time zone shift).
const day = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const count = (n: number) => n.toLocaleString("en-US");

const cards = computed(() => {
  const d = data.value;
  if (!d) return [];
  const paid = `/bookings?paid_from=${d.paid_from}&paid_to=${d.today}`;
  const range = `${day(d.paid_from)} – ${day(d.today)}`;
  return [
    { label: "GMV (30 days)", value: formatMoney(d.gmv_cents), hint: `Paid ${range}, after refunds`, to: paid },
    { label: "Commission (30 days)", value: formatMoney(d.commission_cents), hint: "Before Stripe fees, after refunds", to: paid },
    { label: "Bookings (30 days)", value: count(d.bookings), hint: `Paid ${range}`, to: paid },
    { label: "Active providers", value: count(d.active_providers), hint: "A paid booking in the last 90 days", to: `/providers?paid_since=${d.active_since}` },
  ];
});

const queues = computed(() => {
  const d = data.value;
  if (!d) return [];
  return [
    { label: "Open disputes", value: d.open_disputes, to: "/disputes", icon: "lucide:shield-alert" },
    { label: "Bookings that need attention", value: d.bookings_attention, to: "/bookings#attention-heading", icon: "lucide:triangle-alert" },
    { label: "Guide drafts", value: d.guide_drafts, to: "/content?status=draft", icon: "lucide:file-pen" },
    { label: "Review reports to check", value: reviewReports.value ?? 0, to: "/content/reviews", icon: "lucide:flag" },
    { label: "Providers who can't be paid yet", value: d.providers_not_payable, to: "/providers?status=active&payouts=not_ready", icon: "lucide:wallet" },
  ];
});
</script>

<template>
  <div>
    <PageHeader title="Dashboard" description="Marketplace health at a glance. Dates are Atlanta time." />

    <UiAlert v-if="error" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>The numbers didn't load</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <template v-else>
      <section aria-label="The last 30 and 90 days" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" :aria-busy="pending || undefined">
        <template v-if="data">
          <NuxtLink v-for="card in cards" :key="card.label" :to="card.to"
            class="border-border bg-card hover:border-muted-foreground focus-visible:ring-ring/50 block rounded-lg border p-4 outline-none focus-visible:ring-[3px]">
            <p class="text-muted-foreground text-sm">{{ card.label }}</p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">{{ card.value }}</p>
            <p class="text-muted-foreground mt-1 text-xs">{{ card.hint }}</p>
          </NuxtLink>
        </template>
        <template v-else>
          <div v-for="i in 4" :key="i" class="border-border bg-card rounded-lg border p-4">
            <UiSkeleton class="h-4 w-28" />
            <UiSkeleton class="mt-3 h-7 w-20" />
            <UiSkeleton class="mt-2 h-3 w-36" />
          </div>
        </template>
      </section>

      <h2 class="mt-10 mb-3 text-sm font-semibold">Needs attention</h2>
      <section v-if="data" class="grid gap-3 sm:grid-cols-2">
        <!-- Listings: one row, a link for each kind (each opens its own list). -->
        <div class="border-border bg-card flex items-center justify-between gap-3 rounded-lg border p-4">
          <span class="flex items-center gap-2 text-sm">
            <Icon name="lucide:clipboard-check" class="text-muted-foreground size-4" aria-hidden="true" />
            Listings awaiting review
          </span>
          <span class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
            <NuxtLink to="/listings/experiences?status=submitted" class="font-medium tabular-nums">
              {{ count(data.listings_to_review.experience) }} {{ data.listings_to_review.experience === 1 ? "Experience" : "Experiences" }}
            </NuxtLink>
            <NuxtLink to="/listings/services?status=submitted" class="font-medium tabular-nums">
              {{ count(data.listings_to_review.service) }} {{ data.listings_to_review.service === 1 ? "Service" : "Services" }}
            </NuxtLink>
          </span>
        </div>
        <NuxtLink v-for="q in queues" :key="q.label" :to="q.to"
          class="border-border bg-card hover:border-muted-foreground focus-visible:ring-ring/50 flex items-center justify-between rounded-lg border p-4 outline-none focus-visible:ring-[3px]">
          <span class="flex items-center gap-2 text-sm">
            <Icon :name="q.icon" class="text-muted-foreground size-4" aria-hidden="true" />
            {{ q.label }}
          </span>
          <span class="text-sm font-medium tabular-nums">{{ count(q.value) }}</span>
        </NuxtLink>
      </section>
    </template>
  </div>
</template>
