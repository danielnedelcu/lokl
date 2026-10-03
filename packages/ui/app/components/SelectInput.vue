<script setup lang="ts">
// The one select for both apps (docs/frontend.md, Form controls): ui-thing's
// UiSelect (Reka Select), never a native <select>.
//
// - Options are { value, label, group? }. A value of null or "" ("None",
//   "All areas") works: Reka items can't have an empty value, so it's held
//   as a stand-in inside and turned back here.
// - `id` goes on the trigger, so a <UiLabel for="…"> names it for screen readers.
// - With `name`, a hidden field carries the value for forms that submit as a
//   normal page request (the browse filters): the real value, "" for none.
//   (Reka's own hidden select would submit the stand-in.)
import type { SelectOption } from "../utils/selectOption";

const NONE = "__none__";

const props = withDefaults(
  defineProps<{
    options: SelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string;
    /** 44px tall, for touch targets on the website. */
    touch?: boolean;
    class?: string;
  }>(),
  { placeholder: "Choose…" },
);
const model = defineModel<string | null | undefined>();
const emit = defineEmits<{ blur: [] }>();

// An option's value as Reka holds it: never empty.
const toInner = (v: string | null) => (v === null || v === "" ? NONE : v);
const inner = computed({
  // Undefined shows the placeholder; null and "" are a real "none" option if
  // one is offered, otherwise the placeholder.
  get: () => {
    const v = model.value;
    if (v === undefined) return undefined;
    const hasNone = props.options.some((o) => o.value === null || o.value === "");
    if ((v === null || v === "") && !hasNone) return undefined;
    return toInner(v);
  },
  set: (v: string | undefined) => {
    if (v === undefined) return;
    const option = props.options.find((o) => toInner(o.value) === v);
    model.value = option ? option.value : v;
  },
});

// The chosen option's label, drawn by us: Reka learns labels only once the
// list has mounted in the browser, so a server-rendered page would show the
// placeholder until then.
const chosenLabel = computed(() => props.options.find((o) => inner.value !== undefined && toInner(o.value) === inner.value)?.label);

const groups = computed(() => {
  const out: { label?: string; options: SelectOption[] }[] = [];
  for (const o of props.options) {
    const last = out.at(-1);
    if (last && last.label === o.group) last.options.push(o);
    else out.push({ label: o.group, options: [o] });
  }
  return out;
});
</script>

<template>
  <UiSelect v-model="inner" :disabled="disabled" @update:open="(open: boolean) => { if (!open) emit('blur'); }">
    <UiSelectTrigger :id="id" :class="['w-full', touch && 'data-[size=default]:h-11', props.class]" :aria-invalid="invalid || undefined"
      :aria-describedby="describedby">
      <UiSelectValue :placeholder="placeholder">{{ chosenLabel ?? placeholder }}</UiSelectValue>
    </UiSelectTrigger>
    <UiSelectContent class="max-h-80">
      <template v-for="(g, i) in groups" :key="g.label ?? i">
        <UiSelectGroup v-if="g.label">
          <UiSelectLabel>{{ g.label }}</UiSelectLabel>
          <UiSelectItem v-for="o in g.options" :key="toInner(o.value)" :value="toInner(o.value)" :text="o.label" :disabled="o.disabled" />
        </UiSelectGroup>
        <template v-else>
          <UiSelectItem v-for="o in g.options" :key="toInner(o.value)" :value="toInner(o.value)" :text="o.label" :disabled="o.disabled" />
        </template>
      </template>
    </UiSelectContent>
  </UiSelect>
  <input v-if="name" type="hidden" :name="name" :value="model ?? ''">
</template>
