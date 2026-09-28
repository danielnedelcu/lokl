<script setup lang="ts">
import { bellLabel, notificationText, unreadBadge, type NotificationKind } from "@repo/types";

// The provider dashboard's notification bell (docs/design/notifications.md).
// Lists the 20 most recent, counts all unread, updates live through
// createNotificationFeed(), and tells open pages when a listing changed
// (announceListingChanged), so they refresh.
const props = defineProps<{
  providerId: string;
  /** Where a notification leads, e.g. (id) => `/dashboard/listings/${id}`. */
  listingPath: (listingId: string) => string;
}>();

interface Item {
  id: string;
  kind: NotificationKind;
  listing_id: string;
  created_at: string;
  read_at: string | null;
  listing: { title: string } | null;
}

const supabase = useSupabaseClient();
const items = ref<Item[]>([]);
const unread = ref(0);
const loadFailed = ref(false);
const announcement = ref("");
const open = ref(false);

const textOf = (n: Item) => notificationText(n.kind, n.listing?.title ?? "Your listing");

async function load() {
  const [recent, count] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, listing_id, created_at, read_at, listing:listings(title)")
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
      announceListingChanged(row.listing_id);
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
  await navigateTo(props.listingPath(n.listing_id));
}

const label = computed(() => bellLabel(unread.value));
</script>

<template>
  <div class="relative">
    <UiDropdownMenu v-model:open="open">
      <UiDropdownMenuTrigger as-child>
        <UiButton variant="ghost" size="icon-touch" :aria-label="label" class="relative">
          <Icon name="lucide:bell" class="size-5" aria-hidden="true" />
          <span
            v-if="unread > 0"
            aria-hidden="true"
            class="bg-success text-success-foreground absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-semibold"
          >
            {{ unreadBadge(unread) }}
          </span>
        </UiButton>
      </UiDropdownMenuTrigger>

      <UiDropdownMenuContent align="end" class="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div class="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
          <p class="text-sm font-semibold">Notifications</p>
        </div>
        <!-- A menu item, so it's reachable with the arrow keys; the menu stays open. -->
        <UiDropdownMenuItem v-if="unread > 0" class="text-primary justify-end px-3 py-2 text-sm font-medium"
          @select.prevent="markAllRead()">
          Mark all as read
        </UiDropdownMenuItem>

        <p v-if="loadFailed" class="text-muted-foreground p-4 text-sm">
          Your notifications didn't load. Close this and try again.
        </p>
        <p v-else-if="!items.length" class="text-muted-foreground p-4 text-sm">
          No notifications yet. We'll let you know here when lokl reviews or changes one of your listings.
        </p>
        <div v-else class="max-h-[min(28rem,70vh)] overflow-y-auto py-1">
          <UiDropdownMenuItem
            v-for="n in items"
            :key="n.id"
            class="flex cursor-pointer flex-col items-start gap-1 px-3 py-2.5"
            @select="openItem(n)"
          >
            <span class="flex w-full items-start gap-2">
              <UiBadge v-if="!n.read_at" class="shrink-0">New</UiBadge>
              <span class="text-sm" :class="n.read_at ? 'text-muted-foreground' : 'font-medium'">{{ textOf(n) }}</span>
            </span>
            <span class="text-muted-foreground text-xs">{{ formatAge(n.created_at) }} ago</span>
          </UiDropdownMenuItem>
        </div>
      </UiDropdownMenuContent>
    </UiDropdownMenu>

    <!-- Announces a new notification once, for screen reader users. -->
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
