<script setup lang="ts">
// One of the customer's bookings, and the page Stripe Checkout returns to
// (?checkout=done). The webhook may not have arrived yet, so the page asks
// the server to sync the booking with Stripe until it settles.
definePageMeta({ layout: "public" });

interface Address { line1: string; line2: string | null; city: string; state: string; postal_code: string; instructions: string | null }
interface Detail {
  id: string;
  kind: "service" | "experience";
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  preferred_times: string[] | null;
  party_size: number;
  unit_price_cents: number;
  total_cents: number;
  refunded_cents: number;
  customer_notes: string | null;
  respond_by: string | null;
  cancelled_by: string | null;
  listing: { title: string; slug: string; kind: string; locationMode: string | null; isLive: boolean; market: string; timezone: string } | null;
  listingAddress: Address | null;
  givenAddress: Address | null;
}

const route = useRoute();
const id = String(route.params.id);
const { data: b, error, refresh } = await useFetch<Detail>(`/api/account/bookings/${id}`, { key: `my-booking-${id}` });
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, data: { message: "We couldn't find that booking." }, fatal: true });
}
useSeoMeta({ title: () => b.value?.listing?.title ?? "Booking" });
useLiveData({ refresh });

// Back from Checkout: sync with Stripe a few times until it's no longer
// waiting for payment (usually the first try).
const confirming = ref(false);
onMounted(async () => {
  if (route.query.checkout !== "done" || !b.value) return;
  await navigateTo({ path: route.path }, { replace: true });
  if (b.value.status !== "pending_payment") return;
  confirming.value = true;
  for (let i = 0; i < 6 && b.value?.status === "pending_payment"; i++) {
    await $fetch(`/api/bookings/${id}/sync`, { method: "POST" }).catch(() => null);
    await refresh();
    if (b.value?.status === "pending_payment") await new Promise((r) => setTimeout(r, 2000));
  }
  confirming.value = false;
});

const tz = computed(() => b.value?.listing?.timezone ?? "America/New_York");
const zone = computed(() => timeZoneLabel(b.value?.listing?.market || "Atlanta", tz.value));
const at = (t: string) => `${formatSessionDate(t, tz.value)}, ${formatSessionTime(t, tz.value)}`;
const range = computed(() => {
  if (!b.value?.starts_at) return "";
  const end = b.value.ends_at && b.value.ends_at !== b.value.starts_at ? ` – ${formatSessionTime(b.value.ends_at, tz.value)}` : "";
  return `${formatSessionDate(b.value.starts_at, tz.value)}, ${formatSessionTime(b.value.starts_at, tz.value)}${end}`;
});
const money = (cents: number) => formatMoney(cents, "usd");
const listingPath = computed(() => (b.value?.listing ? `/${b.value.listing.kind === "experience" ? "experiences" : "services"}/${b.value.listing.slug}` : null));

// One plain sentence for where the booking stands.
const summary = computed(() => {
  const s = b.value;
  if (!s) return "";
  switch (s.status) {
    case "pending_payment": return confirming.value ? "Payment received. Confirming your booking…" : "This booking isn't paid yet.";
    case "requested": return `We've sent your request. The provider has until ${s.respond_by ? at(s.respond_by) : "48 hours from now"} to accept one of your times. Your card is held for ${money(s.total_cents)}, not charged.`;
    case "confirmed": return s.kind === "experience" ? `You're booked. You paid ${money(s.total_cents)}.` : `Accepted. You were charged ${money(s.total_cents)}.`;
    case "declined": return "The provider couldn't take this one. The hold on your card was released, so nothing was charged.";
    case "expired": return s.kind === "service" && s.preferred_times ? "This request didn't go through, so nothing was charged." : "This booking didn't go through, so nothing was charged.";
    case "cancelled": return s.refunded_cents > 0 ? `Cancelled. ${money(s.refunded_cents)} was refunded.` : "Cancelled.";
    default: return "This booking has happened.";
  }
});
const address = computed(() => b.value?.listing?.locationMode === "customer_location" ? b.value.givenAddress : b.value?.listingAddress);
</script>

<template>
  <div v-if="b" class="mx-auto max-w-2xl px-4 py-8 md:py-12">
    <NuxtLink to="/account/bookings" class="text-muted-foreground text-sm underline-offset-4 hover:underline">← My bookings</NuxtLink>
    <div class="mt-4 flex flex-wrap items-start justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{{ b.listing?.title ?? "Your booking" }}</h1>
      <StatusBadge kind="booking" :status="b.status" />
    </div>

    <p class="mt-4" role="status" aria-live="polite">{{ summary }}</p>

    <dl class="mt-8 space-y-6">
      <div v-if="b.starts_at">
        <dt class="text-muted-foreground text-sm">When</dt>
        <dd class="mt-1">{{ range }}</dd>
        <dd class="text-muted-foreground text-xs">Times are {{ zone }}.</dd>
      </div>
      <div v-else-if="b.preferred_times?.length">
        <dt class="text-muted-foreground text-sm">The times you offered</dt>
        <dd class="mt-1">
          <ol class="list-inside list-decimal space-y-0.5">
            <li v-for="t in b.preferred_times" :key="t">{{ at(t) }}</li>
          </ol>
        </dd>
        <dd class="text-muted-foreground text-xs">Times are {{ zone }}. The provider accepts one of them.</dd>
      </div>

      <div v-if="b.kind === 'experience'">
        <dt class="text-muted-foreground text-sm">People</dt>
        <dd class="mt-1">{{ b.party_size }}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-sm">Price</dt>
        <dd class="mt-1">
          {{ b.kind === "experience" ? `${b.party_size} × ${money(b.unit_price_cents)} = ${money(b.total_cents)}` : money(b.total_cents) }}
        </dd>
      </div>

      <div>
        <dt class="text-muted-foreground text-sm">Where</dt>
        <dd v-if="address" class="mt-1">
          <address class="not-italic">
            {{ address.line1 }}<br>
            <template v-if="address.line2">{{ address.line2 }}<br></template>
            {{ address.city }}, {{ address.state }} {{ address.postal_code }}
          </address>
          <p v-if="address.instructions" class="text-muted-foreground mt-1 text-sm">{{ address.instructions }}</p>
        </dd>
        <dd v-else class="text-muted-foreground mt-1 text-sm">The exact place is shown here once your booking is confirmed.</dd>
      </div>

      <div v-if="b.customer_notes">
        <dt class="text-muted-foreground text-sm">Your notes</dt>
        <dd class="mt-1 whitespace-pre-line">{{ b.customer_notes }}</dd>
      </div>
    </dl>

    <div class="border-border mt-8 border-t pt-6">
      <CancellationPolicy :kind="b.kind" heading />
    </div>
    <p v-if="listingPath && b.listing?.isLive" class="mt-6 text-sm">
      <NuxtLink :to="listingPath" class="underline underline-offset-4">See the listing</NuxtLink>
    </p>
  </div>
</template>
