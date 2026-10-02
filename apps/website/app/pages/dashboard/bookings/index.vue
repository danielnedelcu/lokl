<script setup lang="ts">
// The provider's bookings (docs/design/booking-and-checkout.md, Provider
// pages): Requests to answer, Upcoming and Past. The customer's email, phone
// and street address appear only once a booking is accepted or confirmed.
definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Bookings" });

const route = useRoute();
const router = useRouter();
const { data, error, refresh } = await useProviderBookings();
// New requests and bookings arrive as notifications, which refresh this.
useLiveData({ refresh, listings: "any" });

type Tab = "requests" | "upcoming" | "past";
const tab = computed<Tab>({
  get: () => (["requests", "upcoming", "past"].includes(String(route.query.tab)) ? (route.query.tab as Tab) : "requests"),
  set: (value) => router.replace({ query: { ...route.query, tab: value } }),
});
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

    <UiTabs v-else-if="data" v-model="tab" class="mt-6">
      <UiTabsList>
        <UiTabsTrigger value="requests">Requests ({{ data.requests.length }})</UiTabsTrigger>
        <UiTabsTrigger value="upcoming">Upcoming</UiTabsTrigger>
        <UiTabsTrigger value="past">Past</UiTabsTrigger>
      </UiTabsList>

      <!-- Requests: answer each one before its time runs out. -->
      <UiTabsContent value="requests" class="mt-4">
        <p v-if="!data.requests.length" class="rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
          No requests to answer.
        </p>
        <ul v-else class="space-y-3">
          <li v-for="b in data.requests" :key="b.id" class="rounded-lg border border-border bg-card p-4">
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
        <p v-if="!data.upcoming.length" class="rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
          No upcoming bookings.
        </p>
        <ul v-else class="space-y-3">
          <li v-for="b in data.upcoming" :key="b.id" class="rounded-lg border border-border bg-card p-4">
            <p class="text-sm font-medium">{{ bookingRange(b) }}</p>
            <h2 class="mt-1 font-medium">{{ b.listing?.title }}</h2>
            <dl class="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt class="text-muted-foreground">Customer</dt>
              <dd>{{ b.customer_name }}<template v-if="b.kind === 'experience'"> · {{ b.party_size }} {{ b.party_size === 1 ? "person" : "people" }}</template></dd>
              <template v-if="b.contact">
                <dt class="text-muted-foreground">Email</dt>
                <dd><a :href="`mailto:${b.contact.email}`" class="underline underline-offset-4">{{ b.contact.email }}</a></dd>
                <template v-if="b.contact.phone">
                  <dt class="text-muted-foreground">Phone</dt>
                  <dd><a :href="`tel:${b.contact.phone}`" class="underline underline-offset-4">{{ b.contact.phone }}</a></dd>
                </template>
              </template>
              <template v-if="b.address">
                <dt class="text-muted-foreground">Address</dt>
                <dd>{{ b.address.line1 }}<template v-if="b.address.line2">, {{ b.address.line2 }}</template>, {{ b.address.city }}, {{ b.address.state }} {{ b.address.postal_code }}</dd>
              </template>
            </dl>
            <p v-if="b.customer_notes" class="mt-2 line-clamp-3 whitespace-pre-line text-sm">“{{ b.customer_notes }}”</p>
            <NuxtLink :to="`/dashboard/bookings/${b.id}`" class="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
              See details
            </NuxtLink>
          </li>
        </ul>
      </UiTabsContent>

      <!-- Past: done, cancelled, declined, or ended unanswered. -->
      <UiTabsContent value="past" class="mt-4">
        <p v-if="!data.past.length" class="rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
          No past bookings yet.
        </p>
        <ul v-else class="divide-y divide-border rounded-lg border border-border bg-card">
          <li v-for="b in data.past" :key="b.id">
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
    </UiTabs>
  </div>
</template>
