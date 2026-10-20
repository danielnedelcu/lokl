<script setup lang="ts">
import { adminRequestWhat, DEFAULT_REFUND_LIMIT_CENTS, marketZone, rpcJson, type AdminMyLimits, type AdminRequestKind } from "@repo/types";
import { HOLD_LABELS, payoutState, whenOf, withFinances } from "~/utils/bookingAdmin";

// One booking, everything about it: the customer's details and no-show note
// (admins only), its history, its emails, and lokl's actions, each with a
// reason. Actions go through the website (useWebsiteAdmin), which has the
// Stripe key and logs them in admin_actions. Support asks the owner where
// the owner is needed (admin roles, step 5b): a refund over the limit (on
// what's left of the charge), a payout release, paying the provider on a
// report. The database decides; the buttons say so first.
const route = useRoute();
const id = String(route.params.id);
const supabase = useSupabaseClient();
const call = useWebsiteAdmin();

const { data, error, refresh } = await useAsyncData(`admin-booking-${id}`, async () => {
  const [b, events, emails, actions, requests, settings] = await Promise.all([
    supabase.from("bookings").select("*, listing:listings(id, title, kind, status, city:cities(name, timezone)), provider:providers(id, display_name, status), finances:booking_finances(*), report:booking_reports(note), hold:provider_holds(during)").eq("id", id).maybeSingle(),
    // bounded: one booking's history
    supabase.from("booking_events").select("from_status, to_status, actor, created_at").eq("booking_id", id).order("created_at"),
    // bounded: one booking's history
    supabase.from("booking_emails").select("id, kind, status, attempts, sent_at, created_at, skip_reason, last_error").eq("booking_id", id).order("created_at"),
    // bounded: one booking's history
    supabase.from("admin_actions").select("action, reason, created_at, admin_id, request:admin_requests(requested_by)").eq("target", "booking").eq("target_id", id).order("created_at"),
    // bounded: one booking's waiting requests (one per kind)
    supabase.from("admin_requests").select("id, kind, resolve_problem, amount_cents, requested_by, created_at").eq("booking_id", id).eq("status", "pending"),
    // Today's limits, live (admin roles, step 5c): the refund limit and support's daily use.
    supabase.rpc("admin_my_limits", {}, { get: true }),
  ]);
  for (const r of [b, events, emails, actions, requests, settings]) if (r.error) throw r.error;
  const limits = rpcJson("admin_my_limits", settings.data);
  const acts = (actions.data ?? []) as unknown as { action: string; reason: string | null; created_at: string; admin_id: string | null; request: { requested_by: string } | null }[];
  const waiting = (requests.data ?? []) as { id: string; kind: AdminRequestKind; resolve_problem: boolean; amount_cents: number | null; requested_by: string; created_at: string }[];
  // Who did what, by email (team members only).
  const ids = [...new Set([...acts.flatMap((a) => [a.admin_id, a.request?.requested_by]), ...waiting.map((r) => r.requested_by)].filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: n, error: nameError } = await supabase.rpc("admin_member_names", { p_ids: ids }, { get: true });
    if (nameError) throw nameError;
    for (const m of n ?? []) names.set(m.user_id, m.email);
  }
  return {
    b: b.data ? withFinances<Record<string, any>>(b.data) : null, events: events.data ?? [], emails: emails.data ?? [], actions: acts,
    waiting, names, limits, refundLimit: limits.refund_limit_cents ?? DEFAULT_REFUND_LIMIT_CENTS,
  };
});
watch(error, (e) => e && reportProblem("Couldn't load the booking", e), { immediate: true });
const b = computed(() => data.value?.b ?? null);
useHead({ title: () => `${b.value?.listing?.title ?? "Booking"} · Admin` });

const money = (cents: number) => formatMoney(cents ?? 0, "usd");
const me = useSupabaseUser();
const role = useAdminRole();
const nameOf = (userId: string | null | undefined) => (userId ? data.value?.names.get(userId) ?? "someone no longer on the team" : "lokl");
// What a refund would refund now: what's left of the charge.
const refundable = computed(() => ["confirmed", "completed", "paid_out"].includes(b.value?.status)
  ? Math.max((b.value?.total_cents ?? 0) - (b.value?.refunded_cents ?? 0), 0) : 0);
// A Service's mode, and the time its hold keeps for it (docs/design/service-availability.md):
// [start, end + the time between bookings). No hold once it's declined,
// expired or cancelled: the time is free again.
const MODES: Record<string, string> = { instant: "Instant: charged when booked", approve: "Approve: the provider accepts each booking" };
const holdText = computed(() => {
  const during = (b.value?.hold as { during: string } | null)?.during;
  if (!during) return "None: the time is free for other bookings";
  // Postgres writes each end as "2026-10-10 15:00:00+00": made ISO before parsing.
  const [from, to] = during.replace(/[[\]()"]/g, "").split(",").map((t) => t.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return `${at(from!)} – ${formatSessionTime(to!, marketZone(b.value?.listing?.city, `booking ${id}`))}`;
});
const at = (iso: string) => {
  const tz = marketZone(b.value?.listing?.city, `booking ${id}`);
  return `${formatSessionDate(iso, tz)}, ${formatSessionTime(iso, tz)}`;
};

// What lokl can do, given where the booking stands.
const openReport = computed(() => !!b.value?.problem_reported_at && !b.value?.problem_resolution && b.value?.status !== "cancelled");
const canCancel = computed(() => ["requested", "confirmed", "completed", "paid_out"].includes(b.value?.status));
const canRelease = computed(() => !!b.value?.payout_hold && b.value.payout_hold !== "problem_reported" && b.value.status !== "paid_out"
  && !(b.value.disputed_at && !b.value.dispute_closed_at));

type Dialog = "cancel" | "release" | "pay" | "refund" | null;
/** Today's refund count or total reached (support): a refund becomes a request (step 5c). */
const dailyRefundsReached = computed(() => {
  const l = data.value?.limits as AdminMyLimits | undefined;
  if (!l?.limited || refundable.value <= 0) return false;
  return l.refunds.used >= l.refunds.limit || l.refund_cents.used + refundable.value > l.refund_cents.limit;
});
/** Support asks the owner for this, rather than doing it (the database refuses it otherwise). */
function needsRequest(action: Exclude<Dialog, null>) {
  if (role.value !== "support") return false;
  if (action === "release" || action === "pay") return true;
  if (b.value?.status === "requested") return false;
  return refundable.value > (data.value?.refundLimit ?? DEFAULT_REFUND_LIMIT_CENTS) || dailyRefundsReached.value;
}
const requestKind = (action: Exclude<Dialog, null>): AdminRequestKind =>
  action === "release" ? "release_payout" : action === "pay" ? "resolve_problem_paid" : "refund";
const waitingFor = (kind: AdminRequestKind) => data.value?.waiting.find((r) => r.kind === kind);
const label = (action: Exclude<Dialog, null>, plain: string, asking: string) => (needsRequest(action) ? asking : plain);
// The chosen action, kept apart from whether the dialog is open
// (docs/frontend.md, confirmation dialogs): closing it mustn't clear the
// action a request is still running for.
const dialog = ref<Dialog>(null);
const open = ref(false);
function ask(action: Exclude<Dialog, null>) {
  dialog.value = action;
  open.value = true;
}
const busy = ref(false);
const problem = ref("");
const done = ref("");
const copy = computed(() => {
  const plain = plainCopy.value;
  const action = dialog.value;
  if (!action || !needsRequest(action) || !b.value) return plain;
  const what = adminRequestWhat({
    kind: requestKind(action), resolveProblem: action === "refund", amountCents: refundable.value,
    listingTitle: b.value.listing?.title, providerName: b.value.provider?.display_name,
  });
  return {
    title: `Ask the owner to ${what}?`,
    description: `${dailyRefundsReached.value && refundable.value <= (data.value?.refundLimit ?? DEFAULT_REFUND_LIMIT_CENTS) ? "You've reached today's limit for refunds, so this" : "This"} needs the owner. They get your request with your reason, and decide within 7 days. Nothing changes until they approve. If they do: ${plain.description}`,
    confirm: "Send the request", destructive: false,
  };
});
const plainCopy = computed(() => {
  const x = b.value;
  if (!x) return { title: "", description: "", confirm: "", destructive: false };
  switch (dialog.value) {
    case "cancel": return {
      title: "Cancel this booking?",
      description: x.status === "requested"
        ? "The hold on the customer's card is released. Both are emailed that lokl cancelled it."
        : x.status === "paid_out"
          ? `The customer is refunded ${money(refundable.value)}, what's left of the charge, and the provider's ${money(x.provider_amount_cents)} transfer is reversed. If their Stripe balance is empty, it's recorded as owed. Both are emailed.`
          : `The customer is refunded ${money(refundable.value)}, what's left of the charge, and the provider isn't paid. Both are emailed that lokl cancelled it.`,
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
      description: `The booking is cancelled and the customer refunded ${money(refundable.value)}, what's left of the charge. The provider isn't paid. Both are emailed the outcome.`,
      confirm: "Refund the customer", destructive: true,
    };
    default: return { title: "", description: "", confirm: "", destructive: false };
  }
});

async function act(reason: string) {
  // Captured first, and used alone from here on: the dialog can be closed
  // while the request runs.
  const action = dialog.value;
  if (!action) return;
  busy.value = true;
  problem.value = "";
  if (needsRequest(action)) {
    // Support asks the owner instead (their own session; the database checks it).
    const { error: e } = await supabase.rpc("admin_request_create", {
      p_kind: requestKind(action), p_booking_id: id, p_provider_id: null as unknown as string, p_reason: reason, p_resolve_problem: action === "refund",
    });
    busy.value = false;
    if (e) {
      problem.value = e.message;
      return;
    }
    done.value = "Request sent to the owner. You'll see their decision in your notifications and on Requests.";
    open.value = false;
    await refresh();
    return;
  }
  try {
    const path = action === "cancel" ? `bookings/${id}/cancel`
      : action === "release" ? `bookings/${id}/release-payout`
      : `bookings/${id}/resolve-problem`;
    const body = action === "pay" ? { outcome: "pay_provider", reason }
      : action === "refund" ? { outcome: "refund", reason }
      : { reason };
    const r = await call(path, body);
    done.value = r.result.charAt(0).toUpperCase() + r.result.slice(1) + ".";
    open.value = false;
  } catch (e) {
    if (isLostReply(e)) {
      // The reply was lost: check whether it went through.
      await refresh();
      const x = b.value;
      const through = !!x && (
        action === "cancel" || action === "refund" ? x.status === "cancelled" && x.cancelled_by === "admin"
        : action === "release" ? !x.payout_hold
        : !!x.problem_resolution);
      if (through) {
        done.value = "Done.";
        open.value = false;
      } else {
        problem.value = LOST_REPLY_TRY_AGAIN;
      }
    } else {
      problem.value = (e as Error).message;
    }
  } finally {
    busy.value = false;
    await refresh();
  }
}
// Contact details: shown on request, each view recorded (admin_booking_contact;
// admin roles, step 5c), within support's daily limit.
const contact = ref<{ email: string | null; phone: string | null; address: { line1: string; line2: string | null; city: string; state: string; postal_code: string; instructions: string | null } | null } | null>(null);
const showingContact = ref(false);
const contactError = ref("");
async function showContact() {
  showingContact.value = true;
  contactError.value = "";
  const { data: c, error: e } = await supabase.rpc("admin_booking_contact", { p_booking_id: id });
  showingContact.value = false;
  if (e) {
    contactError.value = e.message;
    return;
  }
  contact.value = rpcJson("admin_booking_contact", c);
  await refresh();
}
async function withdraw(requestId: string) {
  busy.value = true;
  problem.value = "";
  const { error: e } = await supabase.rpc("admin_request_withdraw", { p_request_id: requestId });
  busy.value = false;
  if (e) problem.value = e.message;
  else done.value = "Request withdrawn.";
  await refresh();
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
    <NuxtLink to="/bookings" class="text-sm text-muted-foreground">← Bookings & payouts</NuxtLink>

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
            <UiButton size="sm" :disabled="busy || !!waitingFor('resolve_problem_paid')" @click="ask('pay')">{{ label("pay", "Pay the provider", "Request to pay the provider") }}</UiButton>
            <UiButton size="sm" :variant="needsRequest('refund') ? 'outline' : 'destructive'" :disabled="busy || !!waitingFor('refund')" @click="ask('refund')">
              {{ label("refund", "Refund the customer", "Request a refund") }}
            </UiButton>
          </div>
        </UiAlertDescription>
      </UiAlert>
      <UiAlert v-if="b.reversal_failed_at" variant="destructive" class="mt-4" icon="lucide:circle-alert">
        <UiAlertTitle>{{ money(b.provider_amount_cents) }} is owed back by the provider</UiAlertTitle>
        <UiAlertDescription>The reversal of their transfer failed: {{ b.reversal_failure }}. Recover it in Stripe for now.</UiAlertDescription>
      </UiAlert>

      <!-- Requests waiting for the owner (admin roles, step 5b). -->
      <UiAlert v-for="r in data!.waiting" :key="r.id" class="mt-4" icon="lucide:hourglass">
        <UiAlertTitle>Waiting for the owner</UiAlertTitle>
        <UiAlertDescription>
          <p>
            {{ r.requested_by === me?.sub ? "You" : nameOf(r.requested_by) }} asked to
            {{ adminRequestWhat({ kind: r.kind, resolveProblem: r.resolve_problem, amountCents: r.amount_cents, listingTitle: b.listing?.title, providerName: b.provider?.display_name }) }},
            {{ formatHomeDateTime(r.created_at) }} (Atlanta time).
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UiButton v-if="r.requested_by === me?.sub" size="sm" variant="outline" :disabled="busy" @click="withdraw(r.id)">Withdraw the request</UiButton>
            <UiButton v-if="role === 'owner'" size="sm" variant="outline" to="/requests">Decide on Requests</UiButton>
          </div>
        </UiAlertDescription>
      </UiAlert>

      <div v-if="canCancel || canRelease" class="mt-6 flex flex-wrap gap-2">
        <UiButton v-if="canRelease" :disabled="busy || !!waitingFor('release_payout')" @click="ask('release')">{{ label("release", "Release payout", "Request a release") }}</UiButton>
        <UiButton v-if="canCancel && !openReport" variant="outline" :disabled="busy || (needsRequest('cancel') && !!waitingFor('refund'))" @click="ask('cancel')">
          {{ b.status === "requested" ? "Cancel request" : label("cancel", "Refund and cancel", "Request a refund") }}
        </UiButton>
      </div>

      <dl class="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div><dt class="text-sm text-muted-foreground">Customer</dt>
          <dd>{{ b.customer_name }}<template v-if="b.kind === 'experience'"> · {{ b.party_size }} {{ b.party_size === 1 ? "person" : "people" }}</template></dd>
          <template v-if="contact">
            <dd class="text-sm">{{ contact.email ?? "No email" }}<template v-if="contact.phone"> · {{ contact.phone }}</template></dd>
            <dd v-if="contact.address" class="text-sm">{{ contact.address.line1 }}<template v-if="contact.address.line2">, {{ contact.address.line2 }}</template>, {{ contact.address.city }}, {{ contact.address.state }} {{ contact.address.postal_code }}</dd>
            <dd v-if="contact.address?.instructions" class="text-muted-foreground text-sm">“{{ contact.address.instructions }}”</dd>
          </template>
          <dd v-else class="mt-1">
            <UiButton size="sm" variant="outline" :disabled="showingContact" @click="showContact">Show contact details</UiButton>
            <p class="text-muted-foreground mt-1 text-xs">
              Each view is recorded.<template v-if="data!.limits.limited"> You've seen {{ data!.limits.contact_views.used }} of {{ data!.limits.contact_views.limit }} today.</template>
            </p>
            <p v-if="contactError" role="alert" class="text-destructive mt-1 text-sm">{{ contactError }}</p>
          </dd>
        </div>
        <div v-if="b.kind === 'service'"><dt class="text-sm text-muted-foreground">Booking mode</dt>
          <dd>{{ MODES[b.service_mode] ?? "Not set" }}</dd>
          <dd class="text-sm">{{ ['declined', 'expired'].includes(b.status) ? "Asked for" : "Time" }}: {{ whenOf(b as any) }}<template v-if="b.ends_at"> – {{ formatSessionTime(b.ends_at, marketZone(b.listing?.city, `booking ${id}`)) }}</template> ({{ b.listing?.city?.name ?? "Atlanta" }} time)</dd>
          <dd class="text-sm">Held: {{ holdText }}</dd>
        </div>
        <div><dt class="text-sm text-muted-foreground">Money</dt>
          <dd v-if="b.confirmed_at">Charged {{ money(b.total_cents) }} · commission {{ money(b.commission_cents) }} ({{ (b.commission_rate_bps / 100).toFixed(1) }}%) · provider {{ money(b.provider_amount_cents) }}</dd>
          <dd v-else-if="b.status === 'requested'">{{ money(b.total_cents) }} on hold on the customer's card, not charged</dd>
          <dd v-else>Not charged ({{ money(b.total_cents) }} was held, then released)</dd>
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
          <li v-for="a in data!.actions" :key="a.created_at" class="font-medium">
            {{ at(a.created_at) }} · {{ actionLabels[a.action] ?? a.action }}: “{{ a.reason }}”
            <span class="font-normal text-muted-foreground">
              <template v-if="a.request">— asked by {{ nameOf(a.request.requested_by) }}, approved by {{ nameOf(a.admin_id) }}</template>
              <template v-else>— by {{ nameOf(a.admin_id) }}</template>
            </span>
          </li>
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
