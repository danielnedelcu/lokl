<script setup lang="ts">
// A searchable select for lists that can grow long, such as choosing a
// provider (docs/frontend.md, Form controls): ui-thing's UiAutocomplete
// (Reka Combobox). Type to narrow the list; arrow keys and Enter choose;
// Escape closes. Same options and none-value handling as SelectInput.
import type { SelectOption } from "../utils/selectOption";

const NONE = "__none__";

const props = withDefaults(
  defineProps<{
    options: SelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    /** Shown when nothing matches what's typed. */
    emptyText?: string;
    disabled?: boolean;
    describedby?: string;
  }>(),
  { placeholder: "Type to search", emptyText: "Nothing matches." },
);
const model = defineModel<string | null | undefined>();

// An option's value as Reka holds it: never empty.
const toInner = (v: string | null) => (v === null || v === "" ? NONE : v);
const inner = computed({
  get: () => (model.value === undefined ? undefined : toInner(model.value)),
  set: (v: string | undefined) => {
    if (v === undefined) return;
    const option = props.options.find((o) => toInner(o.value) === v);
    model.value = option ? option.value : v;
  },
});
const labelFor = (v: unknown) => props.options.find((o) => toInner(o.value) === v)?.label ?? "";
</script>

<template>
  <UiAutocomplete v-model="inner" :disabled="disabled" open-on-click>
    <UiAutocompleteAnchor class="w-full">
      <UiAutocompleteInput :id="id" :placeholder="placeholder" :display-value="labelFor" :aria-describedby="describedby"
        class="min-w-0 flex-1" />
      <UiAutocompleteTrigger aria-label="Show all choices" class="text-muted-foreground px-1">
        <!-- The same single chevron as SelectInput, so the two look alike side by side. -->
        <Icon name="lucide:chevron-down" class="text-muted-foreground size-4" aria-hidden="true" />
      </UiAutocompleteTrigger>
    </UiAutocompleteAnchor>
    <UiAutocompleteContent class="max-h-80 w-(--reka-combobox-trigger-width) min-w-56">
      <UiAutocompleteEmpty class="text-muted-foreground p-2 text-sm">{{ emptyText }}</UiAutocompleteEmpty>
      <UiAutocompleteItem v-for="o in options" :key="toInner(o.value)" :value="toInner(o.value)" :text-value="o.label"
        :disabled="o.disabled">
        {{ o.label }}
      </UiAutocompleteItem>
    </UiAutocompleteContent>
  </UiAutocomplete>
  <input v-if="name" type="hidden" :name="name" :value="model ?? ''">
</template>
