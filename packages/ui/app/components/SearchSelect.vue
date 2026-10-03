<script setup lang="ts">
// A searchable select for lists that can grow long, such as choosing a
// provider (docs/frontend.md, Form controls): ui-thing's UiAutocomplete
// (Reka Combobox). Type to narrow the list; arrow keys and Enter choose;
// Escape closes. Same options and none-value handling as SelectInput.
//
// Two modes:
// - `options` only: the whole list is here, and typing filters it.
// - `search`: the list comes from the server as you type (about 300ms after
//   typing stops; an older search still running is cancelled). `options`
//   then holds what's always offered (such as "Any provider"), and
//   `selectedLabel` names the chosen value after a reload, before any search.
import type { SelectOption } from "../utils/selectOption";

const NONE = "__none__";

const props = withDefaults(
  defineProps<{
    options?: SelectOption[];
    search?: (term: string, signal: AbortSignal) => Promise<SelectOption[]>;
    selectedLabel?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    /** Shown when nothing matches what's typed. */
    emptyText?: string;
    disabled?: boolean;
    describedby?: string;
  }>(),
  { options: () => [], placeholder: "Type to search", emptyText: "Nothing matches." },
);
const model = defineModel<string | null | undefined>();

// An option's value as Reka holds it: never empty.
const toInner = (v: string | null) => (v === null || v === "" ? NONE : v);

// Server mode: the results of the latest search.
const found = shallowRef<SelectOption[]>([]);
const searching = ref(false);
const term = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;
async function runSearch(text: string) {
  if (!props.search) return;
  controller?.abort();
  const mine = (controller = new AbortController());
  searching.value = true;
  try {
    const results = await props.search(text, mine.signal);
    if (!mine.signal.aborted) found.value = results;
  } catch (e) {
    if (!mine.signal.aborted) console.error("[search select] search failed", e);
  } finally {
    if (!mine.signal.aborted) searching.value = false;
  }
}
// Set when the box's text is filled in by us (a name looked up after a
// reload), so it doesn't start a search.
let filling = false;
watch(term, (text) => {
  if (filling) {
    filling = false;
    return;
  }
  if (!props.search) return;
  clearTimeout(timer);
  timer = setTimeout(() => void runSearch(text), 300);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  controller?.abort();
});

const shown = computed(() => (props.search ? [...props.options, ...found.value] : props.options));

// Labels of values chosen, so the box still names the choice once the
// server's list has moved on.
const known = new Map<string, string>();
const inner = computed({
  get: () => (model.value === undefined ? undefined : toInner(model.value)),
  set: (v: string | undefined) => {
    if (v === undefined) return;
    const option = shown.value.find((o) => toInner(o.value) === v);
    if (option) known.set(v, option.label);
    model.value = option ? option.value : v;
  },
});
// After a reload, the chosen value's name arrives after the box has drawn,
// and Reka only refreshes the box's text when the value changes: fill it in.
const typing = ref(false);
watch(
  () => props.selectedLabel,
  (label) => {
    if (!label || typing.value || !model.value || shown.value.some((o) => o.value === model.value)) return;
    filling = true;
    term.value = label;
  },
  { immediate: true },
);

const labelFor = (v: unknown) => {
  const value = typeof v === "string" ? v : "";
  // "Any" or "All" chosen: an empty box with its placeholder, so typing
  // searches rather than adding to "Any provider".
  if (value === NONE) return "";
  const option = shown.value.find((o) => toInner(o.value) === value);
  if (option) return option.label;
  if (known.has(value)) return known.get(value)!;
  return value && value === toInner(model.value ?? null) ? (props.selectedLabel ?? "") : "";
};
</script>

<template>
  <UiAutocomplete v-model="inner" :disabled="disabled" open-on-click :ignore-filter="!!search"
    @update:open="(open: boolean) => { if (open && search && !found.length) void runSearch(''); }">
    <UiAutocompleteAnchor class="w-full">
      <UiAutocompleteInput :id="id" v-model="term" :placeholder="placeholder" :display-value="labelFor"
        :aria-describedby="describedby" :aria-busy="searching || undefined" class="min-w-0 flex-1"
        @focus="(e: FocusEvent) => { typing = true; (e.target as HTMLInputElement).select(); }" @blur="typing = false" />
      <UiAutocompleteTrigger aria-label="Show all choices" class="text-muted-foreground px-1">
        <!-- The same single chevron as SelectInput, so the two look alike side by side. -->
        <Icon name="lucide:chevron-down" class="text-muted-foreground size-4" aria-hidden="true" />
      </UiAutocompleteTrigger>
    </UiAutocompleteAnchor>
    <UiAutocompleteContent class="max-h-80 w-(--reka-combobox-trigger-width) min-w-56">
      <p v-if="search && searching" class="text-muted-foreground p-2 text-sm" role="status">Searching…</p>
      <UiAutocompleteEmpty v-else class="text-muted-foreground p-2 text-sm">{{ emptyText }}</UiAutocompleteEmpty>
      <UiAutocompleteItem v-for="o in shown" :key="toInner(o.value)" :value="toInner(o.value)" :text-value="o.label"
        :disabled="o.disabled">
        <span>
          {{ o.label }}
          <span v-if="o.description" class="text-muted-foreground block text-xs">{{ o.description }}</span>
        </span>
      </UiAutocompleteItem>
    </UiAutocompleteContent>
  </UiAutocomplete>
  <input v-if="name" type="hidden" :name="name" :value="model ?? ''">
</template>
