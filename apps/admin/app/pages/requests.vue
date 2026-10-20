<script setup lang="ts">
import {
  ADMIN_REQUEST_STATUS_LABEL, adminRequestWhat, rpcJson, type AdminRequestRow,
} from "@repo/types";

// Requests (admin roles, step 5b; docs/design/admin-roles.md): what support
// asked the owner to do. The owner sees everyone's, approves (the website
// runs the action, as the owner) or declines with a note the asker sees;
// support sees their own and can withdraw one still waiting. Waiting ones
// first, oldest first; a request lapses after 7 days. A refund shows the
// amount it will refund now, and says so when that changed since the ask.
useHead({ title: "Requests · Admin" });

const supabase = useSupabaseClient();
const callWebsite = useWebsiteAdmin();
const role = useAdminRole();
const me = useSupabaseUser();

const scope = ref<"open" | "closed">("open");
const page = ref(1);
const { data, error, refresh, status } = await useAsyncData("admin-requests", async () => {
  const { data: d, error: e } = await supabase.rpc("admin_requests_page", { p_scope: scope.value, p_page: page.value, p_page_size: 25 }, { get: true });
  if (e) throw e;
  return rpcJson("admin_requests_page", d);
}, { watch: [scope, page] });
watch(error, (e) => e && reportProblem("Couldn't load the requests", e), { immediate: true });
watch(scope, () => (page.value = 1));
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / (data.value?.page_size ?? 25))));

const money = (cents: number | null) => formatMoney(cents ?? 0, "usd");
const subject = (r: AdminRequestRow, amount = r.current_amount_cents ?? r.amount_cents) => ({
  kind: r.kind, resolveProblem: r.resolve_problem, amountCents: amount,
  listingTitle: r.booking?.listing_title, providerName: r.booking?.provider_name ?? r.provider?.name,
});
const changed = (r: AdminRequestRow) => r.kind === "refund" && r.current_amount_cents !== r.amount_cents;
const when = (r: AdminRequestRow) => r.booking?.starts_at ? `${formatSessionDate(r.booking.starts_at, r.booking.timezone)}, ${formatSessionTime(r.booking.starts_at, r.booking.timezone)}` : null;
const link = (r: AdminRequestRow) => (r.booking ? `/bookings/${r.booking.id}` : "/providers");

// What approving does, in the same words as doing it directly.
const effect = (r: AdminRequestRow) => {
  switch (r.kind) {
    case "refund": return `The booking is cancelled and the customer refunded ${money(r.current_amount_cents)}, what's left of the charge. The provider isn't paid. Both are emailed.`;
    case "release_payout": return "The payout hold is cleared, and the provider is paid when it's due.";
    case "resolve_problem_paid": return "The report is resolved in the provider's favour: they're paid as usual, and the customer isn't refunded.";
    case "suspend_provider": return "Their listings are hidden at once. Open requests and unpaid checkouts are withdrawn, and their payouts held. They're emailed.";
    case "reinstate_provider": return "Their listings show again and they can take bookings. They're emailed.";
  }
};

const done = ref("");
const problem = ref("");
const busy = ref(false);

// Approving and declining: the chosen request kept apart from whether its
// dialog is open (the dialog closes itself on a press).
const approving = ref<AdminRequestRow | null>(null);
const approveOpen = ref(false);
const declining = ref<AdminRequestRow | null>(null);
const declineOpen = ref(false);
function askApprove(r: AdminRequestRow) {
  approving.value = r;
  problem.value = "";
  approveOpen.value = true;
}
function askDecline(r: AdminRequestRow) {
  declining.value = r;
  problem.value = "";
  declineOpen.value = true;
}
async function approve() {
  const r = approving.value;
  if (!r) return;
  busy.value = true;
  problem.value = "";
  try {
    const res = await callWebsite(`requests/${r.id}/approve`, r.kind === "refund" ? { expectedAmountCents: r.current_amount_cents } : {});
    done.value = `Approved: ${res.result}.`;
    approveOpen.value = false;
  } catch (e) {
    problem.value = (e as Error).message;
    approveOpen.value = false;
  } finally {
    busy.value = false;
    await refresh();
  }
}
async function decline(note: string) {
  const r = declining.value;
  if (!r) return;
  busy.value = true;
  problem.value = "";
  const { error: e } = await supabase.rpc("admin_request_decline", { p_request_id: r.id, p_note: note });
  busy.value = false;
  if (e) {
    problem.value = e.message;
    return;
  }
  done.value = "Declined. They've been told, with your note.";
  declineOpen.value = false;
  await refresh();
}
async function withdraw(r: AdminRequestRow) {
  busy.value = true;
  problem.value = "";
  const { error: e } = await supabase.rpc("admin_request_withdraw", { p_request_id: r.id });
  busy.value = false;
  if (e) problem.value = e.message;
  else done.value = "Request withdrawn.";
  await refresh();
}
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader title="Requests"
      :description="role === 'owner' ? 'What support asked you to do. Approve to do it now, as you, or decline with a note they see.' : 'What you asked the owner to do, and their decisions.'" />

    <div class="mt-2 flex gap-2" role="group" aria-label="Which requests">
      <UiButton :variant="scope === 'open' ? 'default' : 'outline'" size="sm" class="min-h-9" :aria-pressed="scope === 'open'" @click="scope = 'open'">
        Waiting<template v-if="data"> ({{ data.open_total }})</template>
      </UiButton>
      <UiButton :variant="scope === 'closed' ? 'default' : 'outline'" size="sm" class="min-h-9" :aria-pressed="scope === 'closed'" @click="scope = 'closed'">Decided</UiButton>
    </div>

    <p v-if="done" class="mt-4 text-sm" role="status">{{ done }}</p>
    <p v-if="problem" class="text-destructive mt-4 text-sm" role="alert">{{ problem }}</p>
    <UiAlert v-if="error" variant="destructive" class="mt-4">
      <UiAlertTitle>Couldn't load the requests</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <p v-else-if="status === 'pending' && !data" class="text-muted-foreground mt-6 text-sm">Loading…</p>
    <EmptyState v-else-if="data && !data.rows.length" class="mt-6" icon="lucide:inbox"
      :title="scope === 'open' ? 'Nothing waiting' : 'No decided requests yet'"
      :description="scope === 'open' ? (role === 'owner' ? 'When support asks for something only you can do, it shows here.' : 'When something needs the owner, ask from the booking or provider.') : undefined" />

    <ul v-else-if="data" class="mt-6 space-y-3">
      <li v-for="r in data.rows" :key="r.id" class="bg-card border-border rounded-lg border p-4" :data-testid="`request-${r.id}`">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <p class="font-medium">
            {{ r.requested_by === me?.sub ? "You" : r.requested_by_email ?? "Someone" }} asked to {{ adminRequestWhat(subject(r, r.amount_cents)) }}
          </p>
          <UiBadge :variant="r.status === 'pending' ? 'secondary' : 'outline'">{{ ADMIN_REQUEST_STATUS_LABEL[r.status] }}</UiBadge>
        </div>
        <p class="text-muted-foreground mt-1 text-sm">
          Asked {{ formatHomeDateTime(r.created_at) }} (Atlanta time)<template v-if="r.status === 'pending'"> · expires {{ formatHomeDateTime(r.expires_at) }}</template>
          <template v-if="when(r)"> · booking {{ when(r) }} ({{ r.booking?.market_name }} time)</template>
          · <NuxtLink :to="link(r)" class="link-text">{{ r.booking ? "Open the booking" : "Providers" }}</NuxtLink>
        </p>
        <p class="mt-2 text-sm"><span class="text-muted-foreground">Their reason:</span> “{{ r.reason }}”</p>
        <p v-if="r.message" class="mt-1 text-sm"><span class="text-muted-foreground">Message to the provider:</span> “{{ r.message }}”</p>
        <UiAlert v-if="r.status === 'pending' && changed(r)" class="mt-3" icon="lucide:circle-alert">
          <UiAlertTitle>The amount has changed</UiAlertTitle>
          <UiAlertDescription>
            They asked to refund {{ money(r.amount_cents) }}. What's left of the charge is now {{ money(r.current_amount_cents) }}, so approving refunds {{ money(r.current_amount_cents) }}.
          </UiAlertDescription>
        </UiAlert>
        <p v-if="r.status !== 'pending'" class="mt-2 text-sm">
          <template v-if="r.decided_by_email && r.status !== 'withdrawn'">{{ ADMIN_REQUEST_STATUS_LABEL[r.status] }} by {{ r.decided_by_email }}</template>
          <template v-else>{{ ADMIN_REQUEST_STATUS_LABEL[r.status] }}</template>
          <template v-if="r.decided_at">, {{ formatHomeDateTime(r.decided_at) }} (Atlanta time)</template>.
          <template v-if="r.result"> {{ r.result }}</template>
          <template v-if="r.decision_note"> Note: “{{ r.decision_note }}”</template>
        </p>
        <div v-if="r.status === 'pending'" class="mt-3 flex flex-wrap gap-2">
          <template v-if="role === 'owner'">
            <UiButton size="sm" class="min-h-9" :disabled="busy" @click="askApprove(r)">
              Approve<span class="sr-only">: {{ adminRequestWhat(subject(r)) }}</span>
            </UiButton>
            <UiButton size="sm" variant="outline" class="min-h-9" :disabled="busy" @click="askDecline(r)">
              Decline<span class="sr-only">: {{ adminRequestWhat(subject(r)) }}</span>
            </UiButton>
          </template>
          <UiButton v-if="r.requested_by === me?.sub" size="sm" variant="outline" class="min-h-9" :disabled="busy" @click="withdraw(r)">
            Withdraw<span class="sr-only">: {{ adminRequestWhat(subject(r)) }}</span>
          </UiButton>
        </div>
      </li>
    </ul>

    <div v-if="data && pages > 1" class="mt-4 flex items-center gap-2 text-sm">
      <UiButton size="sm" variant="outline" :disabled="page <= 1" @click="page--">Previous</UiButton>
      <span>Page {{ page }} of {{ pages }}</span>
      <UiButton size="sm" variant="outline" :disabled="page >= pages" @click="page++">Next</UiButton>
    </div>

    <UiAlertDialog v-model:open="approveOpen" :title="approving ? `Approve: ${adminRequestWhat(subject(approving))}?` : 'Approve?'"
      :description="approving ? `${effect(approving)}${changed(approving) ? ` They asked for ${money(approving.amount_cents)}; it's now ${money(approving.current_amount_cents)}.` : ''} It's done as you, with their reason, and they're told.` : ''">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Not now" />
          <UiAlertDialogAction :text="busy ? 'Working…' : 'Approve'" :disabled="busy" @click.prevent="approve" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
    <ProfileHoldsQueue />

    <ReasonDialog v-model:open="declineOpen" :title="declining ? `Decline: ${adminRequestWhat(subject(declining))}?` : 'Decline?'"
      description="Nothing is done. They see your note, so say why in a sentence." confirm-label="Decline" :busy="busy" :error="problem"
      reason-label="Note to them" hint="They see this note in their notifications and on Requests." @confirm="(note: string) => decline(note)" />
  </div>
</template>
