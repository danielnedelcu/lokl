<script setup lang="ts">
import { z } from "zod";
import { canReportProblem, customerCancelOutcome } from "@repo/types";
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
  cancel_reason: string | null;
  status_changed_by: string;
  confirmed_at: string | null;
  payout_due_at: string | null;
  problem_reported_at: string | null;
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
    case "declined": return s.status_changed_by === "system"
      ? "This listing isn't available any more, so your request was cancelled. The hold on your card was released, so nothing was charged."
      : "The provider couldn't take this one. The hold on your card was released, so nothing was charged.";
    case "expired": return s.kind === "service" && s.preferred_times ? "This request didn't go through, so nothing was charged." : "This booking didn't go through, so nothing was charged.";
    case "cancelled": {
      const refund = s.refunded_cents > 0 ? ` ${money(s.refunded_cents)} was refunded to your card.` : s.confirmed_at ? " There was no refund." : " Nothing was charged.";
      if (s.cancelled_by === "provider") return `The provider cancelled: “${s.cancel_reason}”.${refund}`;
      if (s.cancelled_by === "customer") return `You cancelled this booking.${refund}`;
      return `This booking was cancelled.${refund}`;
    }
    default: return "This booking has happened.";
  }
});
// Cancelling: the outcome is stated before confirming (customerCancelOutcome
// in @repo/types is the policy the server applies).
const outcome = computed(() => (b.value ? customerCancelOutcome(b.value) : null));
const canCancel = computed(() => !!outcome.value && outcome.value.kind !== "not_allowed");
const cancelText = computed(() => {
  const o = outcome.value;
  if (!o || !b.value) return "";
  switch (o.kind) {
    case "release": return "The hold on your card is released, so you won't be charged.";
    case "full_refund": return o.reason === "grace"
      ? `You booked less than an hour ago, so you get a full refund of ${money(b.value.total_cents)}. This is free until ${o.graceEndsAtStart ? "it starts, at " : ""}${at(o.graceEndsAt!)}.`
      : `It's more than 48 hours before the start, so you get a full refund of ${money(b.value.total_cents)}.`;
    case "no_refund": return `It's less than 48 hours before the start, so there's no refund. You've paid ${money(b.value.total_cents)}.`;
    default: return "";
  }
});
const confirmCancel = ref(false);
const busy = ref(false);
const problem = ref("");
async function cancelBooking() {
  busy.value = true;
  problem.value = "";
  try {
    await $fetch(`/api/bookings/${id}/cancel`, { method: "POST", body: {} });
    useSonner.success("Your booking is cancelled.");
  } catch (e) {
    problem.value = (e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.";
  } finally {
    busy.value = false;
    confirmCancel.value = false;
    await refresh();
  }
}

// "The provider didn't show up": from the start until the payout.
const canReport = computed(() => !!b.value && canReportProblem(b.value));
const reportOpen = ref(false);
const reportError = ref("");
const { handleSubmit: handleReport } = useForm<{ note: string }>({
  validationSchema: zodSchema(z.object({
    note: z.string().trim().min(10, "Say what happened, in a sentence or two.").max(1000, "Keep it under 1,000 characters."),
  })),
  initialValues: { note: "" },
});
const sendReport = handleReport(async (v) => {
  busy.value = true;
  reportError.value = "";
  try {
    await $fetch(`/api/bookings/${id}/report-problem`, { method: "POST", body: { note: v.note.trim() } });
    reportOpen.value = false;
    useSonner.success("Thanks. We've told lokl.");
  } catch (e) {
    reportError.value = (e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.";
  } finally {
    busy.value = false;
    await refresh();
  }
});

const address = computed(() => b.value?.listing?.locationMode === "customer_location" ? b.value.givenAddress : b.value?.listingAddress);
</script>

<template>
  <div v-if="b" class="mx-auto max-w-2xl px-4 py-8 md:py-12">
    <NuxtLink to="/account/bookings" class="text-muted-foreground text-sm">← My bookings</NuxtLink>
    <div class="mt-4 flex flex-wrap items-start justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{{ b.listing?.title ?? "Your booking" }}</h1>
      <StatusBadge kind="booking" :status="b.status" />
    </div>

    <p class="mt-4" role="status" aria-live="polite">{{ summary }}</p>
    <p v-if="b.problem_reported_at" class="mt-3 text-sm">
      You told us the provider didn't show up. We're looking into it and will be in touch by email.
    </p>
    <p v-if="problem" class="mt-3 text-sm text-destructive" role="alert">{{ problem }}</p>

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

    <div v-if="canCancel || canReport" class="mt-8 flex flex-wrap gap-3">
      <UiButton v-if="canCancel" variant="outline" :disabled="busy" @click="confirmCancel = true">
        {{ b.status === "requested" ? "Cancel request" : "Cancel booking" }}
      </UiButton>
      <UiButton v-if="canReport" variant="outline" :disabled="busy" @click="reportOpen = true">The provider didn't show up</UiButton>
    </div>

    <div class="border-border mt-8 border-t pt-6">
      <CancellationPolicy :kind="b.kind" heading />
    </div>

    <UiAlertDialog v-model:open="confirmCancel" :title="b.status === 'requested' ? 'Cancel this request?' : 'Cancel this booking?'" :description="cancelText">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiAlertDialogAction :text="busy ? 'Cancelling…' : 'Cancel it'" variant="destructive" :disabled="busy" @click.prevent="cancelBooking" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>

    <UiDialog v-model:open="reportOpen">
      <UiDialogContent>
        <UiDialogHeader>
          <UiDialogTitle>The provider didn't show up</UiDialogTitle>
          <UiDialogDescription>
            Tell us what happened. Only lokl sees this. We hold the provider's payment while we look into it, and
            we'll be in touch by email.
          </UiDialogDescription>
        </UiDialogHeader>
        <form class="space-y-3" novalidate @submit="sendReport">
          <UiVeeTextarea name="note" label="What happened?" required :rows="4" maxlength="1000" />
          <p v-if="reportError" class="text-destructive text-sm" role="alert">{{ reportError }}</p>
          <UiDialogFooter>
            <UiButton type="button" variant="outline" @click="reportOpen = false">Not now</UiButton>
            <UiButton type="submit" :disabled="busy">{{ busy ? "Sending…" : "Send to lokl" }}</UiButton>
          </UiDialogFooter>
        </form>
      </UiDialogContent>
    </UiDialog>
    <p v-if="listingPath && b.listing?.isLive" class="mt-6 text-sm">
      <NuxtLink :to="listingPath" class="font-medium">See the listing</NuxtLink>
    </p>
  </div>
</template>
