<!--
  lokl change (2026-10-04): generic over Reka's input type, as Reka's own
  PinInputRoot is, so type="number" (digits only, a numeric keypad) type-
  checks with a number[] model; ui-thing's copy fixed it to "text". Keep this
  if the component is re-added with the ui-thing CLI.
-->
<template>
  <PinInputRoot
    data-slot="pin-input"
    v-bind="forwarded"
    :class="styles({ class: normalizeClass(props.class) || undefined })"
  >
    <slot>
      <template v-for="(input, k) in inputCount" :key="k">
        <UiPinInputInput :aria-invalid :index="k" />
        <template v-if="k < inputCount - 1">
          <span v-if="separator" class="text-muted-foreground">{{ separator }}</span>
        </template>
      </template>
    </slot>
  </PinInputRoot>
</template>

<script lang="ts" setup generic="T extends 'text' | 'number' = 'text'">
  import { PinInputRoot, useForwardPropsEmits } from "reka-ui";
  import type { PinInputRootEmits, PinInputRootProps } from "reka-ui";
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = withDefaults(
    defineProps<
      PinInputRootProps<T> & {
        /** Custom class(es) to apply to the parent element. */
        class?: HTMLAttributes["class"];
        /** The number of inputs to render. @default 4. */
        inputCount?: number;
        /** The separator to render between inputs. @default undefined. */
        separator?: string;
        /** Whether the input should be marked as invalid for accessibility purposes. */
        ariaInvalid?: boolean;
      }
    >(),
    {
      inputCount: 4,
    }
  );

  const emits = defineEmits<PinInputRootEmits<T>>();

  const forwarded = useForwardPropsEmits(
    reactiveOmit(props, "class", "inputCount", "separator"),
    emits
  );
  const styles = tv({
    base: "flex items-center gap-2",
  });
</script>
