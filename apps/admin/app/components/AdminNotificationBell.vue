<script setup lang="ts">
import {
  adminNotificationText, adminRequestDecidedText, adminRequestNewText, adminTeamChangeText, bellLabel,
  type AdminNotificationKind, type AdminRequestKind, type AdminRequestStatus, type AdminTeamAction, type SupportCategory,
} from "@repo/types";
import type { AdminNotificationRow } from "@repo/ui/app/utils/notificationFeed";

// The admin's bell (docs/design/problem-reports.md, Notifications): a new
// report (urgent for Safety) or a provider's reply, and for owners a team
// change (docs/design/admin-roles.md), the 20 most recent and
// every unread counted, for this admin's own login. Live through the same
// feed as the provider's bell (ids only, never text); each new one tells an
// open report page and the board to reload (announceSupportReportChanged).
const supabase = useSupabaseClient();
const user = useSupabaseUser();

interface Item {
  id: string;
  kind: AdminNotificationKind;
  report_id: string | null;
  created_at: string;
  read_at: string | null;
  report: { category: SupportCategory; provider: { display_name: string } | null } | null;
  action: { admin_id: string; target_id: string; action: AdminTeamAction; message: string | null } | null;
  request: {
    kind: AdminRequestKind; status: AdminRequestStatus; resolve_problem: boolean; amount_cents: number | null; requested_by: string;
    booking: { listing: { title: string } | null; provider: { display_name: string } | null } | null;
    provider: { display_name: string } | null;
  } | null;
}
const items = ref<Item[]>([]);
const unread = ref(0);
const loadFailed = ref(false);
const announcement = ref("");
const open = ref(false);

// Team members' emails, for team changes and requests (admin_member_names).
const emails = ref(new Map<string, string>());
const emailOf = (id: string) => (id === user.value?.sub ? "You" : emails.value.get(id) ?? "Someone");
const textOf = (n: Item) => {
  if (n.kind === "team_change") {
    return n.action ? adminTeamChangeText(n.action.action, emailOf(n.action.admin_id), emailOf(n.action.target_id), n.action.message) : "A change to the team.";
  }
  if (n.kind === "request_new" || n.kind === "request_decided") {
    const r = n.request;
    if (!r) return n.kind === "request_new" ? "A request is waiting for you." : "The owner decided on your request.";
    const subject = {
      kind: r.kind, resolveProblem: r.resolve_problem, amountCents: r.amount_cents,
      listingTitle: r.booking?.listing?.title, providerName: r.booking?.provider?.display_name ?? r.provider?.display_name,
    };
    return n.kind === "request_new" ? adminRequestNewText(emailOf(r.requested_by), subject) : adminRequestDecidedText(r.status, subject);
  }
  return adminNotificationText(n.kind, n.report?.provider?.display_name ?? "A provider", n.report?.category ?? "other");
};

async function load() {
  const me = user.value?.sub;
  if (!me) return;
  const [recent, count] = await Promise.all([
    supabase.from("admin_notifications")
      .select("id, kind, report_id, created_at, read_at, report:support_reports(category, provider:providers(display_name)), " +
        "action:admin_actions(admin_id, target_id, action, message), " +
        "request:admin_requests(kind, status, resolve_problem, amount_cents, requested_by, booking:bookings(listing:listings(title), provider:providers(display_name)), provider:providers!admin_requests_provider_id_fkey(display_name))")
      .eq("recipient_id", me).order("created_at", { ascending: false }).limit(20),
    supabase.from("admin_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", me).is("read_at", null),
  ]);
  if (recent.error || count.error) {
    loadFailed.value = true;
    console.error("[admin notifications] couldn't load", recent.error ?? count.error);
    return;
  }
  loadFailed.value = false;
  items.value = recent.data as unknown as Item[];
  unread.value = count.count ?? 0;
  const ids = [...new Set(items.value.flatMap((n) => [n.action?.admin_id, n.action?.target_id, n.request?.requested_by]).filter((x): x is string => !!x))];
  if (ids.length) {
    const { data: names, error } = await supabase.rpc("admin_member_names", { p_ids: ids });
    if (error) console.error("[admin notifications] couldn't load the team's emails", error);
    else emails.value = new Map((names ?? []).map((m) => [m.user_id, m.email]));
  }
}

async function markRead(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  if (error) console.error("[admin notifications] couldn't mark read", error);
  await load();
}
async function markAllRead() {
  const me = user.value?.sub;
  if (!me) return;
  const { error } = await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_id", me).is("read_at", null);
  if (error) console.error("[admin notifications] couldn't mark all read", error);
  await load();
}
async function openItem(n: Item) {
  if (!n.read_at) void markRead([n.id]);
  open.value = false;
  await navigateTo(n.kind === "team_change" ? "/team" : n.kind.startsWith("request_") ? "/requests" : `/reports/${n.report_id}`);
}

let feed: ReturnType<typeof createNotificationFeed<AdminNotificationRow>> | null = null;
function start() {
  feed?.stop();
  const me = user.value?.sub;
  if (!me) return;
  feed = createNotificationFeed<AdminNotificationRow>(supabase, me, {
    onReady: () => void load(),
    onNotification: async (row) => {
      await load();
      const item = items.value.find((n) => n.id === row.id);
      if (item) announcement.value = `New notification: ${textOf(item)}`;
      if (row.report_id) announceSupportReportChanged(row.report_id);
    },
    onProblem: (message) => console.warn("[admin notifications]", message),
    onStatus: (message) => console.info("[admin notifications]", message),
  }, { table: "admin_notifications", column: "recipient_id" });
}
onMounted(() => {
  void load();
  start();
});
watch(() => user.value?.sub, () => {
  void load();
  start();
});
onBeforeUnmount(() => feed?.stop());
// Back to the tab: what arrived while Realtime slept.
useLiveData({ refresh: load });

const label = computed(() => bellLabel(unread.value));
const panelItems = computed(() => items.value.map((n) => ({
  id: n.id, text: textOf(n), unread: !n.read_at, urgent: n.kind === "support_safety", age: formatAge(n.created_at),
})));
</script>

<template>
  <div class="relative">
    <NotificationPanel v-model:open="open" :label="label" :unread="unread" :items="panelItems" :load-failed="loadFailed"
      empty-text="No notifications yet. New problem reports, providers' replies and changes to the team show here."
      @select="(id) => openItem(items.find((n) => n.id === id)!)" @mark-all-read="markAllRead()" />
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
