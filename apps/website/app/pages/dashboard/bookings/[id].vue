<script setup lang="ts">
// One booking on the provider's listings. For a request: the offered times,
// one of which they accept (the card is charged), or Decline (the hold is
// released). Overlaps with their confirmed bookings are a warning only
// (decided 2026-10-02).
import { z } from "zod";
import type { ProviderBooking } from "~/composables/useProviderBookings";

definePageMeta({ layout: "dashboard", middleware: "provider-only" });

interface Detail extends ProviderBooking {
  unit_price_cents: number;
  commission_cents: number;
  refunded_cents: number;
  confirmed_at: string | null;
  payout_due_at: string | null;
  payout_hold: string | null;
  cancel_reason: string | null;
  problem_reported_at: string | null;
  events: { to_status: string; actor: string; created_at: string }[];
  /** For each offered time, the confirmed bookings it overlaps. */
  clashes: { id: string; starts_at: string; ends_at: string | null; title: string }[][];
}

const route = useRoute();
const id = String(route.params.id);
const { data: b, error, refresh } = await useFetch<Detail>(`/api/provider/bookings/${id}`, {
  key: `provider-booking-${id}`,
  headers: useRequestHeaders(["cookie"]),
});
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, data: { message: "We couldn't find that booking." }, fatal: true });
}
useSeoMeta({ title: () => b.value?.listing?.title ?? "Booking" });
useLiveData({ refresh, listings: "any" });

const tz = computed(() => (b.value ? bookingZone(b.value) : "America/New_York"));
const zone = computed(() => timeZoneLabel(b.value?.listing?.city?.name ?? "Atlanta", tz.value));
const money = (cents: number) => formatMoney(cents, "usd");
const at = (t: string) => bookingAt(t, tz.value);

// Answering.
const chosen = ref<string | null>(null);
const chooseError = ref("");
const problem = ref("");
const busy = ref(false);
const confirmAccept = ref(false);
const confirmDecline = ref(false);

function askAccept() {
  chooseError.value = chosen.value ? "" : "Choose one of the times first.";
  if (chosen.value) confirmAccept.value = true;
}
async function answer(action: "accept" | "decline") {
  busy.value = true;
  problem.value = "";
  try {
    await $fetch(`/api/bookings/${id}/${action}`, {
      method: "POST",
      body: action === "accept" ? { startsAt: chosen.value } : undefined,
    });
    useSonner.success(action === "accept" ? "Accepted. The customer's card was charged." : "Declined. The hold on the customer's card was released.");
  } catch (e) {
    problem.value = (e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.";
  } finally {
    busy.value = false;
    confirmAccept.value = false;
    confirmDecline.value = false;
    await Promise.all([refresh(), refreshNuxtData("provider-bookings")]);
  }
}

// One plain sentence for where the booking stands.
const summary = computed(() => {
  const s = b.value;
  if (!s) return "";
  switch (s.status) {
    case "requested": return `Answer by ${at(s.respond_by!)} (${timeLeft(s.respond_by!).toLowerCase()}). The customer's card is on hold for ${money(s.total_cents)}, not charged, until you accept.`;
    case "confirmed": return s.kind === "service" ? `You accepted. The customer was charged ${money(s.total_cents)}.` : `Booked and paid: ${money(s.total_cents)}.`;
    case "declined": return "You declined this request. The customer wasn't charged.";
    case "expired": return s.refunded_cents > 0
      ? "This request ended and the customer was refunded."
      : "This request ended without an answer, or the customer's card couldn't be charged. The customer wasn't charged.";
    case "cancelled":
      if (s.cancelled_by === "provider") return `You cancelled this booking: “${s.cancel_reason}”. The customer was refunded in full.`;
      if (s.cancelled_by === "customer") return s.refunded_cents > 0
        ? "The customer cancelled in time and was refunded, so there's no payout."
        : `The customer cancelled less than 48 hours before, so you'll still be paid ${money(s.provider_amount_cents)}.`;
      return "This booking was cancelled, and the customer was refunded.";
    case "completed": return s.payout_hold
      ? "This booking has happened. lokl is reviewing it before paying you, and will be in touch."
      : `This booking has happened. You'll be paid ${money(s.provider_amount_cents)} after ${at(s.payout_due_at!)}.`;
    case "paid_out": return "This booking has happened and you've been paid.";
    default: return "";
  }
});

// Cancelling a confirmed booking before it starts: always a full refund,
// with a reason the customer sees.
const canCancel = computed(() => b.value?.status === "confirmed" && !!b.value.starts_at && Date.parse(b.value.starts_at) > Date.now());
const cancelOpen = ref(false);
const cancelError = ref("");
const { handleSubmit: handleCancel } = useForm<{ reason: string }>({
  validationSchema: zodSchema(z.object({
    reason: z.string().trim().min(5, "Say why you're cancelling. The customer sees it.").max(1000, "Keep it under 1,000 characters."),
  })),
  initialValues: { reason: "" },
});
const sendCancel = handleCancel(async (v) => {
  busy.value = true;
  cancelError.value = "";
  try {
    await $fetch(`/api/bookings/${id}/cancel`, { method: "POST", body: { reason: v.reason.trim() } });
    cancelOpen.value = false;
    useSonner.success("Cancelled. The customer is refunded in full.");
  } catch (e) {
    cancelError.value = (e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.";
  } finally {
    busy.value = false;
    await Promise.all([refresh(), refreshNuxtData("provider-bookings")]);
  }
});

// Each step of the history in words. Requests and paid bookings are recorded
// by the payment coming through (actor "stripe"), but it was the customer
// who did it (found 2026-10-03: it read "Requested by payment").
function historyLine(e: { to_status: string; actor: string }): string {
  const who = ({ customer: "the customer", stripe: "the customer", provider: "you", admin: "lokl", system: "lokl" } as Record<string, string>)[e.actor] ?? e.actor;
  switch (e.to_status) {
    case "requested": return "Requested by the customer";
    case "confirmed": return e.actor === "provider" ? "Accepted by you" : "Booked and paid by the customer";
    case "declined": return e.actor === "provider" ? "Declined by you" : "Withdrawn by lokl (the listing wasn't available)";
    case "expired":
      return e.actor === "provider" ? "Ended: the customer's card couldn't be charged"
        : e.actor === "stripe" ? "Ended: the hold on the customer's card lapsed" : "Ended: not answered in time";
    case "cancelled": return `Cancelled by ${who}`;
    case "completed": return "Took place";
    case "paid_out": return "Paid out to you";
    default: return `${e.to_status} by ${who}`;
  }
}
const history = computed(() => (b.value?.events ?? []).filter((e) => e.to_status !== "pending_payment"));
</script>

<template>
  <div v-if="b" class="max-w-2xl">
    <NuxtLink to="/dashboard/bookings" class="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">
      ← Bookings
    </NuxtLink>
    <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{{ b.listing?.title ?? "Booking" }}</h1>
      <StatusBadge kind="providerBooking" :status="b.status" />
    </div>
    <p class="mt-3" role="status" aria-live="polite">{{ summary }}</p>
    <p v-if="problem" class="mt-3 text-sm text-destructive" role="alert">{{ problem }}</p>
    <UiAlert v-if="b.problem_reported_at" class="mt-4" icon="lucide:circle-alert">
      <UiAlertTitle>The customer reported a problem</UiAlertTitle>
      <UiAlertDescription>
        They told lokl something went wrong with this booking. Your payout is on hold while lokl looks into it, and
        lokl will be in touch.
      </UiAlertDescription>
    </UiAlert>

    <!-- Answer a request: choose a time, then accept; or decline. -->
    <section v-if="b.status === 'requested'" class="mt-6 rounded-lg border border-border bg-card p-4" aria-labelledby="answer-heading">
      <h2 id="answer-heading" class="font-medium">Choose a time to accept</h2>
      <p class="mt-1 text-xs text-muted-foreground">Times are {{ zone }}.</p>
      <fieldset class="mt-3">
        <legend class="sr-only">Times the customer offered</legend>
        <ul class="space-y-2" :aria-describedby="chooseError ? 'choose-error' : undefined">
          <li v-for="(t, i) in b.preferred_times" :key="t">
            <label class="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/30">
              <input v-model="chosen" type="radio" name="time" :value="t" class="mt-1 size-4">
              <span class="flex-1">
                <span class="block text-sm font-medium">{{ at(t) }}</span>
                <span class="block text-xs text-muted-foreground">{{ i === 0 ? "First choice" : i === 1 ? "Second choice" : "Third choice" }}</span>
                <span v-for="c in b.clashes[i] ?? []" :key="c.id" class="mt-1 flex items-start gap-1 text-xs">
                  <Icon name="lucide:triangle-alert" class="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>Overlaps another booking: {{ c.title }}, {{ at(c.starts_at) }}</span>
                </span>
              </span>
            </label>
          </li>
        </ul>
        <p v-if="chooseError" id="choose-error" class="mt-2 text-sm text-destructive">{{ chooseError }}</p>
      </fieldset>
      <div class="mt-4 flex flex-wrap gap-3">
        <UiButton :disabled="busy" @click="askAccept">Accept this time</UiButton>
        <UiButton variant="outline" :disabled="busy" @click="confirmDecline = true">Decline</UiButton>
      </div>
    </section>

    <dl class="mt-8 space-y-6">
      <div v-if="b.starts_at">
        <dt class="text-sm text-muted-foreground">When</dt>
        <dd class="mt-1">{{ bookingRange(b) }}</dd>
        <dd class="text-xs text-muted-foreground">Times are {{ zone }}.</dd>
      </div>
      <div>
        <dt class="text-sm text-muted-foreground">Customer</dt>
        <dd class="mt-1">
          {{ b.customer_name }}<template v-if="b.kind === 'experience'"> · {{ b.party_size }} {{ b.party_size === 1 ? "person" : "people" }}</template>
        </dd>
        <template v-if="b.contact">
          <dd><a :href="`mailto:${b.contact.email}`" class="underline underline-offset-4">{{ b.contact.email }}</a></dd>
          <dd v-if="b.contact.phone"><a :href="`tel:${b.contact.phone}`" class="underline underline-offset-4">{{ b.contact.phone }}</a></dd>
        </template>
        <dd v-else class="text-xs text-muted-foreground">Their email and phone are shown here once you accept.</dd>
      </div>
      <div v-if="b.listing?.location_mode === 'customer_location'">
        <dt class="text-sm text-muted-foreground">Where</dt>
        <dd v-if="b.address" class="mt-1">
          <address class="not-italic">
            {{ b.address.line1 }}<br>
            <template v-if="b.address.line2">{{ b.address.line2 }}<br></template>
            {{ b.address.city }}, {{ b.address.state }} {{ b.address.postal_code }}
          </address>
          <p v-if="b.address.instructions" class="mt-1 text-sm text-muted-foreground">{{ b.address.instructions }}</p>
        </dd>
        <template v-else>
          <dd class="mt-1">{{ customerArea(b) ?? "Not given" }}</dd>
          <dd class="text-xs text-muted-foreground">The street address is shown here once you accept.</dd>
        </template>
      </div>
      <div v-if="b.customer_notes">
        <dt class="text-sm text-muted-foreground">Their notes</dt>
        <dd class="mt-1 whitespace-pre-line">{{ b.customer_notes }}</dd>
      </div>
      <div>
        <dt class="text-sm text-muted-foreground">Price</dt>
        <dd class="mt-1">
          {{ b.kind === "experience" ? `${b.party_size} × ${money(b.unit_price_cents)} = ${money(b.total_cents)}` : money(b.total_cents) }}
        </dd>
        <dd class="text-sm">You {{ ["requested"].includes(b.status) ? "would receive" : "receive" }} {{ money(b.provider_amount_cents) }} after lokl's commission.</dd>
      </div>
      <div v-if="history.length">
        <dt class="text-sm text-muted-foreground">History</dt>
        <dd class="mt-1">
          <ol class="space-y-0.5 text-sm">
            <li v-for="e in history" :key="e.created_at + e.to_status">
              {{ historyLine(e) }}, {{ at(e.created_at) }}
            </li>
          </ol>
        </dd>
      </div>
    </dl>

    <div v-if="canCancel" class="mt-8 border-t border-border pt-6">
      <UiButton variant="outline" :disabled="busy" @click="cancelOpen = true">Cancel this booking</UiButton>
      <p class="mt-2 text-xs text-muted-foreground">The customer gets a full refund, and you won't be paid for it.</p>
    </div>
    <UiDialog v-model:open="cancelOpen">
      <UiDialogContent>
        <UiDialogHeader>
          <UiDialogTitle>Cancel this booking?</UiDialogTitle>
          <UiDialogDescription>
            {{ b.customer_name }} gets a full refund of {{ money(b.total_cents) }}, and you won't be paid for it.
            This can't be undone.
          </UiDialogDescription>
        </UiDialogHeader>
        <form class="space-y-3" novalidate @submit="sendCancel">
          <UiVeeTextarea name="reason" label="Why are you cancelling?" required :rows="3" maxlength="1000"
            hint="The customer sees this." />
          <p v-if="cancelError" class="text-sm text-destructive" role="alert">{{ cancelError }}</p>
          <UiDialogFooter>
            <UiButton type="button" variant="outline" @click="cancelOpen = false">Keep it</UiButton>
            <UiButton type="submit" variant="destructive" :disabled="busy">{{ busy ? "Cancelling…" : "Cancel and refund" }}</UiButton>
          </UiDialogFooter>
        </form>
      </UiDialogContent>
    </UiDialog>

    <UiAlertDialog v-model:open="confirmAccept" title="Accept this time?"
      :description="chosen ? `${at(chosen)}. The customer's card is charged ${money(b.total_cents)}, and you'll see their contact details.` : ''">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Not yet" />
          <UiAlertDialogAction :text="busy ? 'Accepting…' : 'Accept'" :disabled="busy" @click.prevent="answer('accept')" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
    <UiAlertDialog v-model:open="confirmDecline" title="Decline this request?"
      description="The hold on the customer's card is released, so they aren't charged. This can't be undone.">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiAlertDialogAction :text="busy ? 'Declining…' : 'Decline'" variant="destructive" :disabled="busy" @click.prevent="answer('decline')" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
  </div>
</template>
