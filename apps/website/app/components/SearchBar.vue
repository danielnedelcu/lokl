<script setup lang="ts">
import { NavigationMenuViewport } from "reka-ui";
import { searchPath } from "@repo/types";

// The header's search bar on tablets and wider (docs/design/search.md):
// Where, When, What, and a round Search button. A form (role="search"), not
// navigation, built on Reka's Navigation Menu for its one shared panel (the
// viewport), which stays open and resizes between segments (decided
// 2026-10-12):
// - rendered as plain divs inside the form, never a <nav>;
// - opened by a click or the keyboard only, never hover;
// - each segment a button showing its label and value, with aria-expanded
//   and aria-controls; Escape closes and returns focus to it;
// - choosing a Where opens When, and choosing dates opens What, with focus
//   on that segment's button (so a screen reader hears where it went);
// - Tabbing on to another segment closes the open panel;
// - no size or slide animation with "reduce motion".
const { draft, info, marketSlug, whereValue, whenValue, whenShort, whatValue, request } = useSearch();
const open = ref("");
const form = useTemplateRef<HTMLFormElement>("form");

const segment = (value: string) => form.value?.querySelector<HTMLButtonElement>(`[data-segment="${value}"]`);
async function advance(next: string) {
  open.value = next;
  await nextTick();
  segment(next)?.focus();
}
// Keyboard focus only: a click on another segment switches the shared panel.
function focusSegment(value: string, e: FocusEvent) {
  if (open.value && open.value !== value && (e.target as HTMLElement).matches(":focus-visible")) open.value = "";
}
// Asked to open a segment (the results page's empty state), when the bar is the one showing.
watch(request, (r) => {
  if (r && form.value?.offsetParent) void advance(r.segment);
});
function submit() {
  open.value = "";
  return navigateTo(searchPath(marketSlug.value, { ...draft.value, page: undefined }));
}

// Never grey: not when chosen, focused or hovered (ui-thing's trigger greys
// all three). Square where segments meet (2026-10-12): Where is round on the left only,
// What on the right only, When not at all.
const segmentClass = "flex min-h-16 w-full min-w-0 flex-col items-start justify-center px-4 text-left outline-none hover:bg-transparent focus:bg-transparent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-background data-[state=open]:hover:bg-background data-[state=open]:focus:bg-background";
</script>

<template>
  <!-- The pill (at most 460px) with the three segments; the round Search
       button sits just outside it, in the same form (2026-10-12). -->
  <form ref="form" role="search" aria-label="Search lokl" class="flex w-full max-w-[516px] items-center gap-2" @submit.prevent="submit">
    <UiNavigationMenu v-model="open" as="div" disable-hover-trigger disable-pointer-leave-close class="relative block max-w-[460px] min-w-0 flex-1">
      <!-- One shadow, on the whole pill, while it's hovered or a panel is open
           (so the active segment is always in view, keyboard included); none
           on a segment (2026-10-12). -->
      <div class="bg-background border-border flex items-center rounded-full border transition-shadow hover:shadow-md motion-reduce:transition-none"
        :class="open && 'shadow-md'">
        <UiNavigationMenuList as="div" class="grid min-w-0 flex-1 grid-cols-3 gap-0">
          <UiNavigationMenuItem as="div" value="where" class="min-w-0">
            <UiNavigationMenuTrigger type="button" data-segment="where" :class="[segmentClass, 'rounded-l-full rounded-r-none']" @focus="focusSegment('where', $event)">
              <span class="text-xs font-semibold">Where</span>
              <span class="text-muted-foreground w-full truncate text-sm">{{ whereValue }}</span>
              <template #icon><span /></template>
            </UiNavigationMenuTrigger>
            <UiNavigationMenuContent class="motion-reduce:animate-none">
              <div v-if="info" class="w-[min(36rem,calc(100vw-2rem))] p-6">
                <SearchWhere v-model="draft.area" :info="info" @chosen="advance('when')" />
              </div>
            </UiNavigationMenuContent>
          </UiNavigationMenuItem>
          <UiNavigationMenuItem as="div" value="when" class="border-border min-w-0 border-l">
            <UiNavigationMenuTrigger type="button" data-segment="when" :class="[segmentClass, 'rounded-none']" @focus="focusSegment('when', $event)">
              <span class="text-xs font-semibold">When</span>
              <span class="text-muted-foreground w-full truncate text-sm" aria-hidden="true">{{ whenShort }}</span>
              <span class="sr-only">{{ whenValue }}</span>
              <template #icon><span /></template>
            </UiNavigationMenuTrigger>
            <UiNavigationMenuContent class="motion-reduce:animate-none">
              <div v-if="info" class="p-6">
                <SearchWhen v-model="draft" :time-zone="info.market.timezone" :zone-label="timeZoneLabel(info.market.name, info.market.timezone)"
                  @chosen="advance('what')" />
              </div>
            </UiNavigationMenuContent>
          </UiNavigationMenuItem>
          <UiNavigationMenuItem as="div" value="what" class="border-border min-w-0 border-l">
            <UiNavigationMenuTrigger type="button" data-segment="what" :class="[segmentClass, 'rounded-l-none rounded-r-full']" @focus="focusSegment('what', $event)">
              <span class="text-xs font-semibold">What</span>
              <span class="text-muted-foreground w-full truncate text-sm">{{ whatValue }}</span>
              <template #icon><span /></template>
            </UiNavigationMenuTrigger>
            <UiNavigationMenuContent class="motion-reduce:animate-none">
              <div v-if="info" class="w-[min(30rem,calc(100vw-2rem))] p-6">
                <SearchWhat v-model="draft" :info="info" />
              </div>
            </UiNavigationMenuContent>
          </UiNavigationMenuItem>
        </UiNavigationMenuList>
      </div>
      <template #viewport>
        <div class="absolute top-full left-1/2 z-50 mt-3 -translate-x-1/2">
          <NavigationMenuViewport
            class="bg-popover text-popover-foreground relative h-(--reka-navigation-menu-viewport-height) w-(--reka-navigation-menu-viewport-width) overflow-hidden rounded-3xl border shadow-lg transition-[width,height] duration-300 motion-reduce:transition-none" />
        </div>
      </template>
    </UiNavigationMenu>
    <button type="submit" aria-label="Search"
      class="bg-hosts text-hosts-foreground focus-visible:ring-ring/50 inline-flex size-11 shrink-0 items-center justify-center rounded-full transition outline-none hover:brightness-90 focus-visible:ring-[3px] focus-visible:ring-offset-2">
      <Icon name="lucide:search" class="size-5" aria-hidden="true" />
    </button>
  </form>
</template>
