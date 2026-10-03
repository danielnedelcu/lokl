<!--
  lokl change (2026-10-03): the field's background is the page's background
  colour (bg-background, white in the light theme), not transparent, so every
  input and select looks the same on grey admin pages. Keep it if the
  component is re-added with the ui-thing CLI.
-->
<template>
  <NumberFieldRoot
    v-slot="rootSlotProps"
    data-slot="number-field"
    v-bind="forwarded"
    :class="styles({ class: normalizeClass(props.class) || undefined })"
  >
    <slot v-bind="rootSlotProps">
      <slot name="decrement">
        <UiNumberFieldDecrement />
      </slot>
      <slot name="input">
        <UiNumberFieldInput />
      </slot>
      <slot name="increment">
        <UiNumberFieldIncrement />
      </slot>
    </slot>
  </NumberFieldRoot>
</template>

<script lang="ts" setup>
  import { NumberFieldRoot, useForwardPropsEmits } from "reka-ui";
  import type { NumberFieldRootEmits, NumberFieldRootProps } from "reka-ui";
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = withDefaults(
    defineProps<
      NumberFieldRootProps & {
        class?: HTMLAttributes["class"];
      }
    >(),
    {}
  );

  const emit = defineEmits<NumberFieldRootEmits>();
  const forwarded = useForwardPropsEmits(reactiveOmit(props, "class"), emit);

  const styles = tv({
    base: "border-input selection:bg-primary selection:text-primary-foreground focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex h-9 w-full items-center gap-1 rounded-md border bg-background text-sm shadow-xs transition-[color,box-shadow] outline-none focus-within:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
  });
</script>
