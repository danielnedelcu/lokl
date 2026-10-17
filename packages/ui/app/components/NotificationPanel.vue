<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { unreadBadge } from "@repo/types";

// The notification bell's button and panel, shared by the provider's bell
// (NotificationBell) and the admin's (AdminNotificationBell); each bell
// loads its own rows and says what they mean.
//
// A popover with a list of buttons, not a menu (2026-10-17): Tab reaches
// every notification (a menu takes arrow keys only, and Tab closes it), and
// the list scrolls inside the panel, at most the smaller of 70% of the
// screen and 480px, without scrolling the page behind it
// (overscroll-behavior: contain; data-lenis-prevent, so the website's
// smooth scrolling leaves it alone, as with the carousels). A focused
// notification is scrolled into view.
export interface NotificationPanelItem {
  id: string;
  text: string;
  unread: boolean;
  /** Shown as "Urgent" with an icon (a Safety report, on the admin's bell). */
  urgent?: boolean;
  /** "3 hours", as formatAge gives it. */
  age: string;
}

defineProps<{
  /** The button's name: "Notifications, 2 unread". */
  label: string;
  unread: number;
  items: NotificationPanelItem[];
  loadFailed: boolean;
  emptyText: string;
}>();
const emit = defineEmits<{ select: [id: string]; markAllRead: [] }>();
const open = defineModel<boolean>("open", { default: false });

function intoView(e: FocusEvent) {
  (e.target as HTMLElement).scrollIntoView({ block: "nearest" });
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <UiButton variant="ghost" size="icon-touch" :aria-label="label" class="relative">
        <Icon name="lucide:bell" class="size-5" aria-hidden="true" />
        <span v-if="unread > 0" aria-hidden="true"
          class="bg-success text-success-foreground absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-semibold">
          {{ unreadBadge(unread) }}
        </span>
      </UiButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent align="end" :side-offset="6" :collision-padding="8" aria-label="Notifications"
        class="bg-popover text-popover-foreground border-border data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50 flex w-[min(24rem,calc(100vw-1rem))] flex-col rounded-md border shadow-md outline-none">
        <div class="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
          <p class="text-sm font-semibold">Notifications</p>
          <button v-if="unread > 0" type="button" class="text-primary min-h-9 rounded-sm px-1 text-sm font-medium hover:underline" @click="emit('markAllRead')">
            Mark all as read
          </button>
        </div>
        <p v-if="loadFailed" class="text-muted-foreground p-4 text-sm">Your notifications didn't load. Close this and try again.</p>
        <p v-else-if="!items.length" class="text-muted-foreground p-4 text-sm">{{ emptyText }}</p>
        <ul v-else aria-label="Notifications, newest first" data-lenis-prevent data-notification-list
          class="max-h-[min(70vh,30rem)] overflow-y-auto overscroll-contain py-1">
          <li v-for="n in items" :key="n.id">
            <button type="button" class="hover:bg-accent focus-visible:bg-accent focus-visible:ring-ring/50 flex min-h-11 w-full flex-col items-start gap-1 px-3 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
              @focus="intoView" @click="emit('select', n.id)">
              <span class="flex w-full items-start gap-2">
                <UiBadge v-if="n.urgent" variant="destructive" class="shrink-0"><Icon name="lucide:siren" class="size-3" aria-hidden="true" />Urgent</UiBadge>
                <UiBadge v-if="n.unread" class="shrink-0">New</UiBadge>
                <span class="text-sm" :class="n.unread ? 'font-medium' : 'text-muted-foreground'">{{ n.text }}</span>
              </span>
              <span class="text-muted-foreground text-xs">{{ n.age }} ago</span>
            </button>
          </li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
