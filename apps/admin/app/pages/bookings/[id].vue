<script setup lang="ts">
import { HOLD_LABELS, payoutState, whenOf, withFinances } from "~/utils/bookingAdmin";

// One booking, everything about it: the customer's details and no-show note
// (admins only), its history, its emails, and lokl's actions, each with a
// reason. Actions go through the website (useWebsiteAdmin), which has the
// Stripe key and logs them in admin_actions.
const route = useRoute();
const id = String(route.params.id);
const supabase = useSupabaseClient();
const call = useWebsiteAdmin();

const { data, error, refresh } = await useAsyncData(`admin-booking-${id}`, async () => {
  const [b, events, emails, actions] = await Promise.all([
    supabase.from("bookings").select("*, listing:listings(id, title, kind, status, city:cities(name, timezone)), provider:providers(id, display_name, status), contact:booking_contacts(email, phone), address:booking_addresses(line1, line2, city, state, postal_code, instructions), finances:booking_finances(*), report:booking_reports(note)").eq("id", id).maybeSingle(),
    supabase.from("booking_events").select("from_status, to_status, actor, created_at").eq("booking_id", id).order("created_at"),
    supabase.from("booking_emails").select("id, kind, status, attempts, sent_at, created_at, skip_reason, last_error").eq("booking_id", id).order("created_at"),
    supabase.from("admin_actions").select("action, reason, created_at").eq("target", "booking").eq("target_id", id).order("created_at"),
  ]);
  for (const r of [b, events, emails, actions]) if (r.error) throw r.error;
  return { b: b.data ? withFinances<Record<string, any>>(b.data) : null, events: events.data ?? [], emails: emails.data ?? [], actions: actions.data ?? [] };
});
watch(error, (e) => e && reportProblem("Couldn't load the booking", e), { immediate: true });
const b = computed(() => data.value?.b ?? null);
useHead({ title: () => `${b.value?.listing?.title ?? "Booking"} · Admin` });

const money = (cents: number) => formatMoney(cents ?? 0, "usd");
const at = (iso: string) => {
  const tz = b.value?.listing?.city?.timezone ?? "America/New_York";
  return `${formatSessionDate(iso, tz)}, ${formatSessionTime(iso, tz)}`;
};

// What lokl can do, given where the booking stands.
const openReport = computed(() => !!b.value?.problem_reported_at && !b.value?.problem_resolution && b.value?.status !== "cancelled");
const canCancel = computed(() => ["requested", "confirmed", "completed", "paid_out"].includes(b.value?.status));
const canRelease = computed(() => !!b.value?.payout_hold && b.value.payout_hold !== "problem_reported" && b.value.status !== "paid_out"
  && !(b.value.disputed_at && !b.value.dispute_closed_at));

type Dialog = "cancel" | "release" | "pay" | "refund" | null;
const dialog = ref<Dialog>(null);
const open = computed({ get: () => dialog.value !== null, set: (v) => { if (!v) dialog.value = null; } });
const busy = ref(false);
const problem = ref("");
const done = ref("");
const copy = computed(() => {
  const x = b.value;
  if (!x) return { title: "", description: "", confirm: "", destructive: false };
  switch (dialog.value) {
    case "cancel": return {
      title: "Cancel this booking?",
      description: x.status === "requested"
        ? "The hold on the customer's card is released. Both are emailed that lokl cancelled it."
        : x.status === "paid_out"
          ? `The customer is refunded ${money(x.total_cents)} in full, and the provider's ${money(x.provider_amount_cents)} transfer is reversed. If their Stripe balance is empty, it's recorded as owed. Both are emailed.`
          : `The customer is refunded ${money(x.total_cents)} in full, and the provider isn't paid. Both are emailed that lokl cancelled it.`,
      confirm: x.status === "requested" ? "Cancel the request" : "Refund and cancel", destructive: true,
    };
    case "release": return {
      title: "Release this payout?",
      description: `The hold (${HOLD_LABELS[x.payout_hold] ?? x.payout_hold}) is cleared, and ${money(x.provider_amount_cents)} goes to the provider${x.payout_due_at && Date.parse(x.payout_due_at) <= Date.now() ? " now" : " when it's due"}.`,
      confirm: "Release the payout", destructive: false,
    };
    case "pay": return {
      title: "Resolve the report: pay the provider?",
      description: `The provider is paid ${money(x.provider_amount_cents)} as usual, and emailed that they'll be paid. The customer isn't refunded.`,
      confirm: "Pay the provider", destructive: false,
    };
    case "refund": return {
      title: "Resolve the report: refund the customer?",
      description: `The booking is cancelled and the customer refunded ${money(x.total_cents)} in full. The provider isn't paid. Both are emailed the outcome.`,
      confirm: "Refund the customer", destructive: true,
    };
    default: return { title: "", description: "", confirm: "", destructive: false };
  }
});

async function act(reason: string) {
  busy.value = true;
  problem.value = "";
  try {
    const path = dialog.value === "cancel" ? `bookings/${id}/cancel`
      : dialog.value === "release" ? `bookings/${id}/release-payout`
      : `bookings/${id}/resolve-problem`;
    const body = dialog.value === "pay" ? { outcome: "pay_provider", reason }
      : dialog.value === "refund" ? { outcome: "refund", reason }
      : { reason };
    const r = await call(path, body);
    done.value = r.result.charAt(0).toUpperCase() + r.result.slice(1) + ".";
    dialog.value = null;
  } catch (e) {
    problem.value = (e as Error).message;
  } finally {
    busy.value = false;
    await refresh();
  }
}
async function retry(emailId: string) {
  busy.value = true;
  try {
    await call(`emails/${emailId}/retry`);
    done.value = "Email queued and sent again.";
  } catch (e) {
    done.value = "";
    problem.value = (e as Error).message;
  } finally {
    busy.value = false;
    await refresh();
  }
}

const actionLabels: Record<string, string> = {
  cancel_booking: "Cancelled by lokl", release_payout: "Payout released", resolve_problem_paid: "Report resolved: provider paid",
  resolve_problem_refunded: "Report resolved: customer refunded",
};
</script>

<template>
  <div class="max-w-3xl">
    <NuxtLink to="/bookings" class="text-sm text-muted-foreground underline-offset-4 hover:underline">← Bookings & payouts</NuxtLink>

    <UiAlert v-if="error" variant="destructive" class="mt-4">
      <UiAlertTitle>Couldn't load the booking</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="data && !b" class="mt-4" icon="lucide:receipt" title="No such booking" description="It may have been typed wrong." />

    <template v-else-if="b">
      <div class="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ b.listing?.title ?? "Booking" }}</h1>
          <p class="text-sm text-muted-foreground">{{ b.kind === "experience" ? "Experience" : "Service" }} · {{ b.provider?.display_name }} · {{ whenOf(b as any) }}</p>
        </div>
        <StatusBadge kind="adminBooking" :status="b.status" />
      </div>

      <p v-if="done" class="mt-4 text-sm" role="status">{{ done }}</p>
      <p v-if="problem" class="mt-4 text-sm text-destructive" role="alert">{{ problem }}</p>

      <!-- What needs deciding -->
      <UiAlert v-if="openReport" class="mt-4" icon="lucide:circle-alert">
        <UiAlertTitle>The customer reported a problem</UiAlertTitle>
        <UiAlertDescription>
          <p class="whitespace-pre-line">“{{ b.problem_note }}”</p>
          <p class="mt-1 text-xs">Reported {{ at(b.problem_reported_at) }}. Only lokl sees this note. The payout is held until you decide.</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <UiButton size="sm" :disabled="busy" @click="dialog = 'pay'">Pay the provider</UiButton>
            <UiButton size="sm" variant="destructive" :disabled="busy" @click="dialog = 'refund'">Refund the customer</UiButton>
          </div>
        </UiAlertDescription>
      </UiAlert>
      <UiAlert v-if="b.reversal_failed_at" variant="destructive" class="mt-4" icon="lucide:circle-alert">
        <UiAlertTitle>{{ money(b.provider_amount_cents) }} is owed back by the provider</UiAlertTitle>
        <UiAlertDescription>The reversal of their transfer failed: {{ b.reversal_failure }}. Recover it in Stripe for now.</UiAlertDescription>
      </UiAlert>

      <div v-if="canCancel || canRelease" class="mt-6 flex flex-wrap gap-2">
        <UiButton v-if="canRelease" :disabled="busy" @click="dialog = 'release'">Release payout</UiButton>
        <UiButton v-if="canCancel && !openReport" variant="outline" :disabled="busy" @click="dialog = 'cancel'">
          {{ b.status === "requested" ? "Cancel request" : "Refund and cancel" }}
        </UiButton>
      </div>

      <dl class="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div><dt class="text-sm text-muted-foreground">Customer</dt>
          <dd>{{ b.customer_name }}<template v-if="b.kind === 'experience'"> · {{ b.party_size }} {{ b.party_size === 1 ? "person" : "people" }}</template></dd>
          <dd v-if="b.contact" class="text-sm">{{ b.contact.email }}<template v-if="b.contact.phone"> · {{ b.contact.phone }}</template></dd>
          <dd v-if="b.address" class="text-sm">{{ b.address.line1 }}, {{ b.address.city }}, {{ b.address.state }} {{ b.address.postal_code }}</dd>
        </div>
        <div><dt class="text-sm text-muted-foreground">Money</dt>
          <dd>Paid {{ money(b.total_cents) }} · commission {{ money(b.commission_cents) }} ({{ (b.commission_rate_bps / 100).toFixed(1) }}%) · provider {{ money(b.provider_amount_cents) }}</dd>
          <dd v-if="b.refunded_cents" class="text-sm">Refunded {{ money(b.refunded_cents) }}</dd>
        </div>
        <div><dt class="text-sm text-muted-foreground">Payout</dt>
          <dd>{{ payoutState(b as any) }}</dd>
          <dd v-if="b.payout_failure" class="text-sm text-muted-foreground">{{ b.payout_failure }}</dd>
          <dd v-if="b.stripe_transfer_id" class="text-sm"><code>{{ b.stripe_transfer_id }}</code></dd>
        </div>
        <div v-if="b.disputed_at"><dt class="text-sm text-muted-foreground">Dispute</dt>
          <dd>{{ b.dispute_closed_at ? `Closed: ${b.dispute_outcome}` : "Open" }} · {{ b.dispute_reason }}</dd>
          <dd v-if="b.dispute_evidence_due_by && !b.dispute_closed_at" class="text-sm">Evidence due {{ at(b.dispute_evidence_due_by) }}</dd>
        </div>
        <div v-if="b.cancelled_by"><dt class="text-sm text-muted-foreground">Cancelled</dt>
          <dd>By {{ b.cancelled_by === "admin" ? "lokl" : b.cancelled_by }}<template v-if="b.cancel_reason">: “{{ b.cancel_reason }}”</template></dd>
        </div>
        <div v-if="b.problem_resolution"><dt class="text-sm text-muted-foreground">Reported problem</dt>
          <dd>Resolved {{ at(b.problem_resolved_at) }}: {{ b.problem_resolution === "paid_provider" ? "provider paid" : "customer refunded" }}</dd>
          <dd class="text-sm whitespace-pre-line text-muted-foreground">“{{ b.problem_note }}”</dd>
        </div>
      </dl>

      <section class="mt-8" aria-labelledby="history-heading">
        <h2 id="history-heading" class="font-medium">History</h2>
        <ol class="mt-2 space-y-1 text-sm">
          <li v-for="e in data!.events" :key="e.created_at + e.to_status">{{ at(e.created_at) }} · {{ e.from_status ?? "new" }} → {{ e.to_status }} by {{ e.actor }}</li>
          <li v-for="a in data!.actions" :key="a.created_at" class="font-medium">{{ at(a.created_at) }} · {{ actionLabels[a.action] ?? a.action }}: “{{ a.reason }}”</li>
        </ol>
      </section>

      <section class="mt-8" aria-labelledby="emails-heading">
        <h2 id="emails-heading" class="font-medium">Emails</h2>
        <p v-if="!data!.emails.length" class="mt-2 text-sm text-muted-foreground">None.</p>
        <ul v-else class="mt-2 space-y-1 text-sm">
          <li v-for="e in data!.emails" :key="e.id" class="flex flex-wrap items-center gap-2">
            <code>{{ e.kind }}</code> · {{ e.status }}{{ e.sent_at ? ` ${at(e.sent_at)}` : "" }}
            <span v-if="e.skip_reason || e.last_error" class="text-muted-foreground">({{ e.skip_reason ?? e.last_error }})</span>
            <UiButton v-if="e.status === 'failed' || e.status === 'skipped'" size="sm" variant="outline" :disabled="busy" @click="retry(e.id)">Send again</UiButton>
          </li>
        </ul>
      </section>
    </template>

    <ReasonDialog v-model:open="open" :title="copy.title" :description="copy.description" :confirm-label="copy.confirm"
      :destructive="copy.destructive" :busy="busy" :error="problem" @confirm="act" />
  </div>
</template>
