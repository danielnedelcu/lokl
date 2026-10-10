<script setup lang="ts">
// The provider's bookings (docs/design/booking-and-checkout.md, Provider
// pages): Requests to answer, Upcoming and Past, 20 at a time, each tab
// counted and paged by the database. The customer's email, phone and street
// address appear only once a booking is accepted or confirmed.
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "Bookings" });

const route = useRoute();
const router = useRouter();
const tab = computed<ProviderBookingTab>({
  get: () => (["requests", "upcoming", "past"].includes(String(route.query.tab)) ? (route.query.tab as ProviderBookingTab) : "requests"),
  set: (value) => router.replace({ query: { ...route.query, tab: value } }),
});
const { data, error, refresh } = await useProviderBookings(tab);
// New requests and bookings arrive as notifications, which refresh this.
useLiveData({ refresh, listings: "any" });

// "Show more bookings": later pages, added below the first.
const more = ref<ProviderBooking[]>([]);
const page = ref(1);
const loadingMore = ref(false);
const moreError = ref("");
// A refresh or another tab starts again from page one.
watch(data, () => {
  more.value = [];
  page.value = 1;
  moreError.value = "";
});
// Only this tab's bookings: while another tab loads, the last one's stay hidden.
const current = computed(() => (data.value?.tab === tab.value ? data.value : null));
const items = computed(() => [...(current.value?.items ?? []), ...more.value]);
const total = computed(() => current.value?.total ?? 0);
const counts = computed(() => data.value?.counts ?? { requests: 0, upcoming: 0, past: 0 });
async function showMore() {
  loadingMore.value = true;
  moreError.value = "";
  const firstNew = items.value.length;
  try {
    const next = await fetchProviderBookingsPage(tab.value, page.value + 1);
    more.value = [...more.value, ...next.items];
    page.value += 1;
    // Focus the first new booking, so keyboard users carry on from there.
    await nextTick();
    document.querySelectorAll<HTMLElement>("[data-booking]")[firstNew]?.focus();
  } catch {
    moreError.value = "More bookings didn't load. Try again.";
  } finally {
    loadingMore.value = false;
  }
}
const money = (cents: number) => formatMoney(cents, "usd");
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="text-2xl font-semibold tracking-tight">Bookings</h1>
    <p class="mt-1 text-sm text-muted-foreground">Requests to answer, and your upcoming and past bookings.</p>

    <UiAlert v-if="error" variant="destructive" class="mt-6" icon="lucide:alert-circle">
      <UiAlertTitle>Your bookings didn't load</UiAlertTitle>
      <UiAlertDescription>Please refresh the page to try again.</UiAlertDescription>
    </UiAlert>

    <UiTabs v-else v-model="tab" class="mt-6">
      <UiTabsList>
        <UiTabsTrigger value="requests">Requests ({{ counts.requests }})</UiTabsTrigger>
        <UiTabsTrigger value="upcoming">Upcoming ({{ counts.upcoming }})</UiTabsTrigger>
        <UiTabsTrigger value="past">Past ({{ counts.past }})</UiTabsTrigger>
      </UiTabsList>

      <!-- Requests: answer each one before its time runs out. -->
      <UiTabsContent value="requests" class="mt-4">
        <p v-if="current && !items.length" class="rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
          No requests to answer.
        </p>
        <ul v-else class="space-y-3">
          <li v-for="b in items" :key="b.id" data-booking tabindex="-1" class="rounded-lg border border-border bg-card p-4 outline-none">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 class="font-medium">{{ b.listing?.title }}</h2>
                <p class="text-sm">
                  {{ b.customer_name }}<template v-if="customerArea(b)"> · {{ customerArea(b) }}</template>
                </p>
              </div>
              <p class="flex items-center gap-1 text-sm font-medium">
                <Icon name="lucide:clock" class="size-4" aria-hidden="true" />
                {{ timeLeft(b.respond_by!) }}
              </p>
            </div>
            <p class="mt-2 text-sm text-muted-foreground">Answer by {{ bookingAt(b.respond_by!, bookingZone(b)) }}.</p>
            <p class="mt-3 text-sm font-medium">Times offered</p>
            <ol class="mt-1 list-inside list-decimal text-sm">
              <li v-for="t in b.preferred_times" :key="t">{{ bookingAt(t, bookingZone(b)) }}</li>
            </ol>
            <p v-if="b.customer_notes" class="mt-3 line-clamp-3 whitespace-pre-line text-sm">“{{ b.customer_notes }}”</p>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm text-muted-foreground">You'd receive {{ money(b.provider_amount_cents) }}</p>
              <UiButton :to="`/dashboard/bookings/${b.id}`">Answer this request</UiButton>
            </div>
          </li>
        </ul>
      </UiTabsContent>

      <!-- Upcoming: accepted or paid, with the customer's details. -->
      <UiTabsContent value="upcoming" class="mt-4">
        <p v-if="current && !items.length" class="rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
          No upcoming bookings.
        </p>
        <ul v-else class="space-y-3">
          <li v-for="b in items" :key="b.id" data-booking tabindex="-1" class="rounded-lg border border-border bg-card p-4 outline-none">
            <p class="text-sm font-medium">{{ bookingRange(b) }}</p>
            <h2 class="mt-1 font-medium">{{ b.listing?.title }}</h2>
            <dl class="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt class="text-muted-foreground">Customer</dt>
              <dd>{{ b.customer_name }}<template v-if="b.kind === 'experience'"> · {{ b.party_size }} {{ b.party_size === 1 ? "person" : "people" }}</template></dd>
              <template v-if="b.contact">
                <dt class="text-muted-foreground">Email</dt>
                <dd><a :href="`mailto:${b.contact.email}`" class="font-medium">{{ b.contact.email }}</a></dd>
                <template v-if="b.contact.phone">
                  <dt class="text-muted-foreground">Phone</dt>
                  <dd><a :href="`tel:${b.contact.phone}`" class="font-medium">{{ b.contact.phone }}</a></dd>
                </template>
              </template>
              <template v-if="b.address">
                <dt class="text-muted-foreground">Address</dt>
                <dd>{{ b.address.line1 }}<template v-if="b.address.line2">, {{ b.address.line2 }}</template>, {{ b.address.city }}, {{ b.address.state }} {{ b.address.postal_code }}</dd>
              </template>
            </dl>
            <p v-if="b.customer_notes" class="mt-2 line-clamp-3 whitespace-pre-line text-sm">“{{ b.customer_notes }}”</p>
            <NuxtLink :to="`/dashboard/bookings/${b.id}`" class="mt-3 inline-flex min-h-11 items-center text-sm font-medium">
              See details
            </NuxtLink>
          </li>
        </ul>
      </UiTabsContent>

      <!-- Past: done, cancelled, declined, or ended unanswered. -->
      <UiTabsContent value="past" class="mt-4">
        <p v-if="current && !items.length" class="rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
          No past bookings yet.
        </p>
        <ul v-else class="divide-y divide-border rounded-lg border border-border bg-card">
          <li v-for="b in items" :key="b.id" data-booking tabindex="-1" class="outline-none">
            <NuxtLink :to="`/dashboard/bookings/${b.id}`" class="flex min-h-11 flex-wrap items-center justify-between gap-2 p-4 hover:bg-accent">
              <span>
                <span class="block font-medium">{{ b.listing?.title }}</span>
                <span class="block text-sm text-muted-foreground">
                  {{ b.starts_at ? bookingRange(b) : `Requested for ${b.preferred_times?.length ?? 0} ${b.preferred_times?.length === 1 ? "time" : "times"}` }}
                  · {{ b.customer_name }}
                </span>
              </span>
              <StatusBadge kind="providerBooking" :status="b.status" />
            </NuxtLink>
          </li>
        </ul>
      </UiTabsContent>
      <div v-if="items.length < total" class="mt-4">
        <UiButton variant="outline" :disabled="loadingMore" @click="showMore">{{ loadingMore ? "Loading…" : "Show more bookings" }}</UiButton>
        <p v-if="moreError" role="alert" class="mt-2 text-sm text-destructive">{{ moreError }}</p>
      </div>
    </UiTabs>
  </div>
</template>
