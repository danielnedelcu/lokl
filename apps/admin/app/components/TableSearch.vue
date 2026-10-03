<script setup lang="ts">
// The search box at the right of an admin table's filters. It waits about
// 300ms after typing stops before searching (useServerTable cancels any
// search still running), and follows the URL when it changes another way
// (Back, a cleared filter) unless you're typing in it.
const props = withDefaults(defineProps<{
  value: string;
  id?: string;
  placeholder?: string;
  hint?: string;
  /** Full width until this breakpoint, then a 16rem box on the right ("xl" where it sits under a two-column form). */
  fullUntil?: "sm" | "xl";
}>(), {
  fullUntil: "sm",
  id: "table-search",
  placeholder: "Search",
  hint: "Results update as you type.",
});
const emit = defineEmits<{ search: [q: string] }>();

const text = ref(props.value);
const focused = ref(false);
watch(() => props.value, (v) => {
  if (!focused.value) text.value = v;
});
let timer: ReturnType<typeof setTimeout> | undefined;
function onInput() {
  clearTimeout(timer);
  timer = setTimeout(() => emit("search", text.value), 300);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div :class="fullUntil === 'xl' ? 'w-full xl:ml-auto xl:w-64' : 'w-full sm:ml-auto sm:w-64'">
    <UiLabel :for="id" class="mb-1">Search</UiLabel>
    <UiInput :id="id" v-model="text" type="search" :placeholder="placeholder" :aria-describedby="`${id}-hint`"
      @input="onInput" @focus="focused = true" @blur="focused = false" />
    <p :id="`${id}-hint`" class="sr-only">{{ hint }}</p>
  </div>
</template>
