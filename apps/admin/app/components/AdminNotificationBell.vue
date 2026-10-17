<script setup lang="ts">
import { adminNotificationText, bellLabel, unreadBadge, type AdminNotificationKind, type SupportCategory } from "@repo/types";
import type { AdminNotificationRow } from "@repo/ui/app/utils/notificationFeed";

// The admin's bell (docs/design/problem-reports.md, Notifications): a new
// report (urgent for Safety) or a provider's reply, the 20 most recent and
// every unread counted, for this admin's own login. Live through the same
// feed as the provider's bell (ids only, never text); each new one tells an
// open report page and the board to reload (announceSupportReportChanged).
const supabase = useSupabaseClient();
const user = useSupabaseUser();

interface Item {
  id: string;
  kind: AdminNotificationKind;
  report_id: string;
  created_at: string;
  read_at: string | null;
  report: { category: SupportCategory; provider: { display_name: string } | null } | null;
}
const items = ref<Item[]>([]);
const unread = ref(0);
const loadFailed = ref(false);
const announcement = ref("");
const open = ref(false);

const textOf = (n: Item) =>
  adminNotificationText(n.kind, n.report?.provider?.display_name ?? "A provider", n.report?.category ?? "other");

async function load() {
  const me = user.value?.sub;
  if (!me) return;
  const [recent, count] = await Promise.all([
    supabase.from("admin_notifications")
      .select("id, kind, report_id, created_at, read_at, report:support_reports(category, provider:providers(display_name))")
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
  await navigateTo(`/reports/${n.report_id}`);
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
      announceSupportReportChanged(row.report_id);
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
</script>

<template>
  <div class="relative">
    <UiDropdownMenu v-model:open="open">
      <UiDropdownMenuTrigger as-child>
        <UiButton variant="ghost" size="icon-touch" :aria-label="label" class="relative">
          <Icon name="lucide:bell" class="size-5" aria-hidden="true" />
          <span v-if="unread > 0" aria-hidden="true"
            class="bg-success text-success-foreground absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-semibold">
            {{ unreadBadge(unread) }}
          </span>
        </UiButton>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent align="end" class="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div class="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
          <p class="text-sm font-semibold">Notifications</p>
        </div>
        <UiDropdownMenuItem v-if="unread > 0" class="text-primary justify-end px-3 py-2 text-sm font-medium" @select.prevent="markAllRead()">
          Mark all as read
        </UiDropdownMenuItem>
        <p v-if="loadFailed" class="text-muted-foreground p-4 text-sm">Your notifications didn't load. Close this and try again.</p>
        <p v-else-if="!items.length" class="text-muted-foreground p-4 text-sm">
          No notifications yet. New problem reports and providers' replies show here.
        </p>
        <div v-else class="max-h-[min(28rem,70vh)] overflow-y-auto py-1">
          <UiDropdownMenuItem v-for="n in items" :key="n.id" class="flex cursor-pointer flex-col items-start gap-1 px-3 py-2.5" @select="openItem(n)">
            <span class="flex w-full items-start gap-2">
              <UiBadge v-if="n.kind === 'support_safety'" variant="destructive" class="shrink-0"><Icon name="lucide:siren" class="size-3" aria-hidden="true" />Urgent</UiBadge>
              <UiBadge v-else-if="!n.read_at" class="shrink-0">New</UiBadge>
              <span class="text-sm" :class="n.read_at ? 'text-muted-foreground' : 'font-medium'">{{ textOf(n) }}</span>
            </span>
            <span class="text-muted-foreground text-xs">{{ formatAge(n.created_at) }} ago</span>
          </UiDropdownMenuItem>
        </div>
      </UiDropdownMenuContent>
    </UiDropdownMenu>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
