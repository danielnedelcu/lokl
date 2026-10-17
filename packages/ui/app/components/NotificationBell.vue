<script setup lang="ts">
import { SUPPORT_CATEGORY_ABOUT, bellLabel, notificationText, type NotificationKind, type SupportCategory } from "@repo/types";

// The provider dashboard's notification bell (docs/design/notifications.md).
// Lists the 20 most recent, counts all unread, updates live through
// createNotificationFeed(), and tells open pages when a listing changed
// (announceListingChanged), so they refresh. A reply to a problem report has
// no listing: it reads by the report's category, leads to the report, and
// tells an open report page to reload its thread (announceSupportReportChanged).
const props = defineProps<{
  providerId: string;
  /** Where a notification leads, e.g. (id) => `/dashboard/listings/${id}`. */
  listingPath: (listingId: string) => string;
  /** Where a booking notification leads, e.g. (id) => `/dashboard/bookings/${id}`. */
  bookingPath?: (bookingId: string) => string;
  /** Where a reply to a problem report leads, e.g. (id) => `/dashboard/help/${id}`. */
  supportPath?: (reportId: string) => string;
}>();

interface Item {
  id: string;
  kind: NotificationKind;
  listing_id: string | null;
  booking_id: string | null;
  support_report_id: string | null;
  created_at: string;
  read_at: string | null;
  listing: { title: string } | null;
  support_report: { category: SupportCategory } | null;
}

const supabase = useSupabaseClient();
const items = ref<Item[]>([]);
const unread = ref(0);
const loadFailed = ref(false);
const announcement = ref("");
const open = ref(false);

const textOf = (n: Item) => notificationText(n.kind, n.kind === "support_reply"
  ? (n.support_report ? SUPPORT_CATEGORY_ABOUT[n.support_report.category] : "a problem")
  : n.listing?.title ?? "Your listing");

async function load() {
  const [recent, count] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, listing_id, booking_id, support_report_id, created_at, read_at, listing:listings(title), support_report:support_reports(category)")
      .eq("provider_id", props.providerId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", props.providerId)
      .is("read_at", null),
  ]);
  if (recent.error || count.error) {
    loadFailed.value = true;
    console.error("[notifications] couldn't load", recent.error ?? count.error);
    return;
  }
  loadFailed.value = false;
  items.value = recent.data as unknown as Item[];
  unread.value = count.count ?? 0;
}

// Live: refetch on each new notification (the list shows titles, which the
// Realtime row doesn't carry), announce it once, and tell open pages.
let feed: ReturnType<typeof createNotificationFeed> | null = null;
function start() {
  feed?.stop();
  feed = createNotificationFeed(supabase, props.providerId, {
    onReady: () => void load(),
    onNotification: async (row) => {
      console.info("[notifications] received", row.kind);
      await load();
      const item = items.value.find((n) => n.id === row.id);
      if (item) announcement.value = `New notification: ${textOf(item)}`;
      if (row.listing_id) announceListingChanged(row.listing_id);
      if (row.support_report_id) announceSupportReportChanged(row.support_report_id);
    },
    onProblem: (message) => console.warn("[notifications]", message),
    onStatus: (message) => console.info("[notifications]", message),
  });
}
onMounted(() => {
  void load();
  start();
});
watch(() => props.providerId, () => {
  void load();
  start();
});
onBeforeUnmount(() => feed?.stop());

// The database sets the time; the value sent only has to be non-null.
async function markRead(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  if (error) console.error("[notifications] couldn't mark read", error);
  await load();
}
// Every unread one, including any older than the 20 shown.
async function markAllRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("provider_id", props.providerId)
    .is("read_at", null);
  if (error) console.error("[notifications] couldn't mark all read", error);
  await load();
}

async function openItem(n: Item) {
  if (!n.read_at) void markRead([n.id]);
  open.value = false;
  const to = n.support_report_id && props.supportPath ? props.supportPath(n.support_report_id)
    : n.booking_id && props.bookingPath ? props.bookingPath(n.booking_id)
    : n.listing_id ? props.listingPath(n.listing_id)
    : null;
  if (to) await navigateTo(to);
}

const label = computed(() => bellLabel(unread.value));
const panelItems = computed(() => items.value.map((n) => ({ id: n.id, text: textOf(n), unread: !n.read_at, age: formatAge(n.created_at) })));
</script>

<template>
  <div class="relative">
    <NotificationPanel v-model:open="open" :label="label" :unread="unread" :items="panelItems" :load-failed="loadFailed"
      empty-text="No notifications yet. We'll let you know here about new bookings, and when lokl reviews or changes one of your listings."
      @select="(id) => openItem(items.find((n) => n.id === id)!)" @mark-all-read="markAllRead()" />
    <!-- Announces a new notification once, for screen reader users. -->
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
