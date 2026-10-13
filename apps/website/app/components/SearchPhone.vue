<script setup lang="ts">
import { searchPath } from "@repo/types";

// The header search on phones (docs/design/search.md): one Search button,
// named with what's chosen, opening a full-screen dialog (focus stays inside;
// Escape or Close returns focus to the button). Inside, Where, When and What
// are stacked, each a button showing its value that opens its panel below
// it (aria-expanded), one at a time; choosing a Where opens When, and
// choosing dates opens What, as in the bar. Clear all, and Search.
const { draft, info, marketSlug, whereValue, whenValue, whatValue, request } = useSearch();
const shown = ref(false);
const section = ref<"where" | "when" | "what" | "">("where");
const sections = computed(() => [
  { key: "where" as const, label: "Where", value: whereValue.value },
  { key: "when" as const, label: "When", value: whenValue.value },
  { key: "what" as const, label: "What", value: whatValue.value },
]);
const trigger = useTemplateRef<HTMLButtonElement>("trigger");

async function advance(next: "when" | "what") {
  section.value = next;
  await nextTick();
  document.getElementById(`search-phone-${next}`)?.focus();
}
watch(request, (r) => {
  if (r && trigger.value?.offsetParent) {
    section.value = r.segment as typeof section.value;
    shown.value = true;
  }
});
function clearAll() {
  draft.value = {};
  section.value = "where";
}
function submit() {
  shown.value = false;
  return navigateTo(searchPath(marketSlug.value, { ...draft.value, page: undefined }));
}
</script>

<template>
  <UiDialog v-model:open="shown">
    <UiDialogTrigger as-child>
      <button ref="trigger" type="button" :aria-label="`Search: ${whereValue}, ${whenValue}, ${whatValue}`"
        class="bg-background border-border focus-visible:ring-ring/50 flex min-h-11 w-full min-w-0 items-center gap-3 rounded-full border px-4 text-left shadow-md outline-none focus-visible:ring-[3px]">
        <Icon name="lucide:search" class="size-5 shrink-0" aria-hidden="true" />
        <span class="min-w-0">
          <span class="block text-sm font-semibold">Search</span>
          <span class="text-muted-foreground block truncate text-xs">{{ whereValue }} · {{ whenValue }} · {{ whatValue }}</span>
        </span>
      </button>
    </UiDialogTrigger>
    <UiDialogContent hide-close
      class="inset-0 top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none motion-reduce:animate-none">
      <form role="search" aria-label="Search lokl" class="flex min-h-0 flex-1 flex-col" @submit.prevent="submit">
        <div class="border-border flex items-center justify-between border-b px-4 py-2">
          <UiDialogTitle class="text-base font-semibold">Search</UiDialogTitle>
          <UiDialogClose class="hover:bg-muted focus-visible:ring-ring/50 inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]" aria-label="Close">
            <Icon name="lucide:x" class="size-5" aria-hidden="true" />
          </UiDialogClose>
        </div>
        <UiDialogDescription class="sr-only">Choose where, when and what, then search.</UiDialogDescription>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div v-for="s in sections" :key="s.key" class="border-border rounded-2xl border">
            <button :id="`search-phone-${s.key}`" type="button" :aria-expanded="section === s.key" :aria-controls="`search-phone-${s.key}-panel`"
              class="focus-visible:ring-ring/50 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left outline-none focus-visible:ring-[3px]"
              @click="section = section === s.key ? '' : s.key">
              <span class="min-w-0">
                <span class="block text-xs font-semibold">{{ s.label }}</span>
                <span class="text-muted-foreground block truncate text-sm">{{ s.value }}</span>
              </span>
              <Icon name="lucide:chevron-down" class="size-4 shrink-0 transition-transform motion-reduce:transition-none" :class="section === s.key && 'rotate-180'" aria-hidden="true" />
            </button>
            <div v-if="section === s.key && info" :id="`search-phone-${s.key}-panel`" class="px-4 pb-4">
              <SearchWhere v-if="s.key === 'where'" v-model="draft.area" :info="info" @chosen="advance('when')" />
              <SearchWhen v-else-if="s.key === 'when'" v-model="draft" :time-zone="info.market.timezone"
                :zone-label="timeZoneLabel(info.market.name, info.market.timezone)" @chosen="advance('what')" />
              <SearchWhat v-else v-model="draft" :info="info" />
            </div>
          </div>
        </div>
        <div class="border-border flex items-center justify-between gap-3 border-t px-4 py-3">
          <button type="button" class="link-text min-h-11 text-sm" @click="clearAll">Clear all</button>
          <!-- The hosts' orange, like the bar's Search button: white text at 4.99:1.
               Darker on hover (never lighter, which would lower the contrast). -->
          <button type="submit"
            class="bg-hosts text-hosts-foreground focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold whitespace-nowrap transition outline-none hover:brightness-90 focus-visible:ring-2 focus-visible:ring-offset-2">
            <Icon name="lucide:search" class="size-4" aria-hidden="true" />Search
          </button>
        </div>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
